use lyra_desktop::music::runtime::{MusicRuntimeConfig, SuperColliderRuntime};
use std::path::PathBuf;

const TRACK: &str = r#"(
~lyraTrack = (
  synthDefs: [
    SynthDef(\lyra_voice_1, { |out=0, amp=0.06, gate=1, pan=0, freq=110|
      var env = EnvGen.kr(Env.asr(0.2, 1, 1.5), gate, doneAction: Done.freeSelf);
      var sig = LPF.ar(SinOsc.ar(freq), 1200);
      Out.ar(out, Pan2.ar(sig, pan) * amp * env);
    })
  ],
  pattern: Pbind(
    \instrument, \lyra_voice_1,
    \dur, Pseq([1, 2, 1, 4], inf),
    \degree, Pseq([0, 4, 2, 5], inf),
    \amp, 0.06
  )
);
)"#;

#[test]
#[ignore = "ローカルSuperCollider実行環境が必要"]
fn long_lived_runtime_boots_and_plays_a_muted_fixture() {
    let directory = tempfile::tempdir().unwrap();
    let track_path = directory.path().join("track.scd");
    std::fs::write(&track_path, TRACK).unwrap();
    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/supercollider");
    let home = PathBuf::from(std::env::var_os("HOME").unwrap());
    let sclang = std::env::var_os("LYRA_SCLANG_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            home.join("Library/Application Support/app.lyra.focus/supercollider/runtime/sclang")
        });
    let mut runtime = SuperColliderRuntime::start(MusicRuntimeConfig {
        sclang_path: sclang,
        scsynth_path: PathBuf::from("/Applications/SuperCollider.app/Contents/Resources/scsynth"),
        language_config: resources.join("sclang_conf.yaml"),
        bootstrap_script: resources.join("bootstrap.scd"),
        plugin_path: PathBuf::from("/Applications/SuperCollider.app/Contents/Resources/plugins"),
        xdg_config_home: directory.path().join("config"),
        xdg_data_home: directory.path().join("data"),
    })
    .unwrap();
    let metrics = runtime
        .validate_muted("fixture", track_path.to_string_lossy().as_ref(), 60.0, 42)
        .unwrap();
    assert!(metrics.average_cpu < 70.0);
    assert!(metrics.peak_cpu < 90.0);
    assert!(metrics.maximum_synths < 512);
}
