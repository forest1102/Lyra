use lyra_desktop::music::codex_client::{resolve_codex_binary, GenerationControls};
use lyra_desktop::music::generation::GenerationService;
use lyra_desktop::music::runtime::{MusicRuntimeConfig, SuperColliderRuntime};
use lyra_desktop::music::validator::StaticValidator;
use std::path::PathBuf;

#[test]
#[ignore = "Codex認証とローカルSuperCollider実行環境が必要"]
fn codex_generates_supercollider_source_that_sclang_accepts() {
    let directory = tempfile::tempdir().unwrap();
    let client = lyra_desktop::music::codex_client::CodexClient::start(
        resolve_codex_binary(),
        directory.path().join("generation"),
    )
    .unwrap();
    let mut service = GenerationService::new(client);
    let draft = service
        .generate(
            GenerationControls {
                theme: "deep-space".into(),
                arrangement: "ambient".into(),
                brightness: "medium".into(),
                density: "medium".into(),
                motion: "low".into(),
            },
            false,
        )
        .unwrap();
    assert!(!draft.title.is_empty());
    assert!(draft.supercollider_source.contains("track_"));

    let track_path = directory.path().join("generated.scd");
    std::fs::write(&track_path, &draft.supercollider_source).unwrap();
    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/supercollider");
    let home = PathBuf::from(std::env::var_os("HOME").unwrap());
    let installed_sclang =
        home.join("Library/Application Support/app.lyra.focus/supercollider/runtime/sclang");
    let sclang = std::env::var_os("LYRA_SCLANG_PATH")
        .map(PathBuf::from)
        .unwrap_or(installed_sclang);
    let report = StaticValidator::new()
        .validate_with_sclang(
            &sclang,
            &resources.join("sclang_conf.yaml"),
            &resources.join("validate.scd"),
            &track_path,
        )
        .unwrap();
    assert_eq!(report.events_evaluated, 256);

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
        .validate_muted(
            &draft.id,
            track_path.to_string_lossy().as_ref(),
            draft.bpm as f32,
            draft.canonical_seed,
        )
        .unwrap();
    assert!(metrics.average_cpu < 70.0);
    assert!(metrics.peak_cpu < 90.0);
    assert!(metrics.maximum_synths < 512);
}
