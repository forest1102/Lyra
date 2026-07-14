use lyra_desktop::music::source_policy::{SourcePolicy, SourcePolicyError};

const VALID: &str = r#"(
~lyraTrack = (
  synthDefs: [
    SynthDef(\lyra_voice_1, { |out=0, amp=0.08, gate=1, pan=0, freq=220|
      var env = EnvGen.kr(Env.asr(0.5, 1, 3), gate, doneAction: Done.freeSelf);
      var sig = SinOsc.ar(freq);
      Out.ar(out, Pan2.ar(sig, pan) * amp * env);
    })
  ],
  pattern: Pbind(
    \instrument, \lyra_voice_1,
    \dur, Pseq([1, 2, 1, 4], inf),
    \degree, Pwhite(0, 7, inf),
    \amp, 0.08
  )
);
)"#;

#[test]
fn accepts_the_constrained_track_contract() {
    let validation = SourcePolicy::v1().validate(VALID).unwrap();
    assert_eq!(validation.synth_def_names, vec!["lyra_voice_1"]);
}

#[test]
fn ignores_forbidden_words_inside_comments_and_strings() {
    let source = VALID.replace(
        "var sig = SinOsc.ar(freq);",
        "// Buffer and .play are documentation\n      var label = \"fork Pfunc\";\n      var sig = SinOsc.ar(freq);",
    );
    SourcePolicy::v1().validate(&source).unwrap();
}

#[test]
fn rejects_forbidden_selectors_and_classes() {
    for token in [".play", ".add", "Buffer", "Pfunc", "SoundIn", "GVerb"] {
        let error = SourcePolicy::v1()
            .validate(&format!("{VALID}\n{token}"))
            .unwrap_err();
        assert!(
            error.to_string().contains(token),
            "unexpected error: {error}"
        );
    }
}

#[test]
fn rejects_unknown_selectors_even_when_they_are_not_explicitly_forbidden() {
    let error = SourcePolicy::v1()
        .validate(&format!("{VALID}\nSinOsc.evil(1)"))
        .unwrap_err();
    assert!(error.to_string().contains(".evil"));
}

#[test]
fn rejects_pattern_routing_keys() {
    let source = VALID.replace("\\amp, 0.08", "\\out, 0, \\amp, 0.08");
    let error = SourcePolicy::v1().validate(&source).unwrap_err();
    assert!(matches!(error, SourcePolicyError::ForbiddenSymbol(symbol) if symbol == "out"));
}

#[test]
fn requires_all_synthdef_controls_and_cleanup() {
    let source = VALID.replace("gate=1, ", "").replace("Done.freeSelf", "0");
    let error = SourcePolicy::v1().validate(&source).unwrap_err();
    assert!(error.to_string().contains("gate"));
}

#[test]
fn rewrites_only_placeholder_symbols() {
    let source = format!("// \\lyra_voice_1 stays in docs\n{VALID}");
    let rewritten = SourcePolicy::v1()
        .namespace_synth_defs(&source, "track_a1b2")
        .unwrap();

    assert!(rewritten.contains("// \\lyra_voice_1 stays in docs"));
    assert!(rewritten.contains("\\track_a1b2_voice_1"));
    assert!(!rewritten
        .lines()
        .skip(1)
        .any(|line| line.contains("\\lyra_voice_1")));
}
