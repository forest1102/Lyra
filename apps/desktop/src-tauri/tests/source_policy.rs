use lyra_desktop::music::source_policy::{SourcePolicy, SourcePolicyError};

const VALID: &str = r#"
Math.srandom(__LYRA_SEED__);
SinOsc oscillator => ADSR envelope => LPF filter => Pan2 pan => Gain master => dac;
0.12 => master.gain;
440 => oscillator.freq;
while (true) {
    envelope.keyOn();
    500::ms => now;
}
"#;

#[test]
fn accepts_a_bounded_webchuck_voice() {
    let validation = SourcePolicy::v1().validate(VALID).unwrap();
    assert_eq!(validation.voice_count, 1);
}

#[test]
fn ignores_forbidden_words_inside_comments_and_strings() {
    let source = VALID.replace(
        "440 => oscillator.freq;",
        "// FileIO and adc are documentation\n\"Machine.eval\" => string label;\n440 => oscillator.freq;",
    );
    SourcePolicy::v1().validate(&source).unwrap();
}

#[test]
fn rejects_external_io_and_dynamic_runtime_access() {
    for token in ["adc", "FileIO", "Machine", "MidiIn", "HidIn", "OscIn"] {
        let error = SourcePolicy::v1()
            .validate(&format!("{VALID}\n{token} blocked;"))
            .unwrap_err();
        assert!(
            error.to_string().contains(token),
            "unexpected error: {error}"
        );
    }
}

#[test]
fn rejects_unknown_ugens() {
    let error = SourcePolicy::v1()
        .validate(&VALID.replace("SinOsc", "UnsafeOsc"))
        .unwrap_err();
    assert!(matches!(error, SourcePolicyError::UnknownClass(name) if name == "UnsafeOsc"));
}

#[test]
fn requires_exactly_one_seed_placeholder() {
    let missing = VALID.replace("Math.srandom(__LYRA_SEED__);", "Math.srandom(42);");
    assert!(SourcePolicy::v1().validate(&missing).is_err());

    let duplicate = format!("Math.srandom(__LYRA_SEED__);\n{VALID}");
    assert!(SourcePolicy::v1().validate(&duplicate).is_err());
}

#[test]
fn rejects_nested_or_unbounded_voice_loops() {
    let nested = VALID.replace(
        "envelope.keyOn();",
        "while (true) { 10::ms => now; }\nenvelope.keyOn();",
    );
    assert!(SourcePolicy::v1().validate(&nested).is_err());

    let missing_advance = VALID.replace("500::ms => now;", "oscillator.freq => float value;");
    assert!(SourcePolicy::v1().validate(&missing_advance).is_err());

    let two_advances = VALID.replace("500::ms => now;", "250::ms => now;\n250::ms => now;");
    assert!(SourcePolicy::v1().validate(&two_advances).is_err());

    let conditional = VALID.replace("while (true)", "while (running)");
    assert!(SourcePolicy::v1().validate(&conditional).is_err());

    let additional_loop = VALID.replace(
        "envelope.keyOn();",
        "for (0 => int i; i < 2; i++) { envelope.keyOn(); }",
    );
    assert!(SourcePolicy::v1().validate(&additional_loop).is_err());
}

#[test]
fn rejects_out_of_range_audio_parameters() {
    for invalid in [
        VALID.replace("0.12 => master.gain;", "1.01 => master.gain;"),
        VALID.replace("440 => oscillator.freq;", "0.001 => oscillator.freq;"),
        VALID.replace("440 => oscillator.freq;", "20001 => oscillator.freq;"),
    ] {
        assert!(SourcePolicy::v1().validate(&invalid).is_err());
    }
}

#[test]
fn accepts_sub_audible_frequency_for_slow_modulation() {
    let source = VALID.replace(
        "440 => oscillator.freq;",
        "440 => oscillator.freq;\nSinOsc slowLfo;\n1.04 => slowLfo.freq;",
    );

    SourcePolicy::v1().validate(&source).unwrap();
}

#[test]
fn injects_only_the_integer_seed_placeholder() {
    let source = format!("// __LYRA_SEED__ stays in docs\n{VALID}");
    let injected = SourcePolicy::v1().inject_seed(&source, 42).unwrap();

    assert!(injected.contains("// __LYRA_SEED__ stays in docs"));
    assert!(injected.contains("Math.srandom(42);"));
    assert!(!injected
        .lines()
        .skip(1)
        .any(|line| line.contains("__LYRA_SEED__")));
}

#[test]
fn rejects_unbalanced_delimiters() {
    let error = SourcePolicy::v1()
        .validate(&VALID.replace("}", ""))
        .unwrap_err();
    assert!(error.to_string().contains("delimiter"));
}
