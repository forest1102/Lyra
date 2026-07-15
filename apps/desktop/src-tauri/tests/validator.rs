use lyra_desktop::music::validator::{AudioValidation, StaticValidator, ValidationError};

const VALID_SOURCE: &str = r#"
Math.srandom(__LYRA_SEED__);
SinOsc oscillator => ADSR envelope => LPF filter => Pan2 pan => Gain master => dac;
0.12 => master.gain;
while (true) {
    envelope.keyOn();
    500::ms => now;
}
"#;

fn valid_json() -> String {
    serde_json::json!({
        "schemaVersion": 1,
        "title": "Nebula Drift",
        "description": "A slow spacious focus loop.",
        "bpm": 64,
        "tailSeconds": 4,
        "chuckSource": VALID_SOURCE
    })
    .to_string()
}

#[test]
fn validates_the_chuck_schema_and_source_policy() {
    let validated = StaticValidator::new().validate_json(&valid_json()).unwrap();
    assert_eq!(validated.result.title, "Nebula Drift");
    assert_eq!(validated.source.voice_count, 1);
    assert_eq!(validated.audio_validation, AudioValidation::Required);
}

#[test]
fn focus_mode_defers_audio_validation() {
    let validated = StaticValidator::new()
        .validate_json_during_focus(&valid_json())
        .unwrap();
    assert_eq!(
        validated.audio_validation,
        AudioValidation::DeferredUntilFocusEnds
    );
}

#[test]
fn rejects_invalid_metadata_at_stage_one() {
    let invalid = serde_json::json!({
        "schemaVersion": 1,
        "title": "",
        "description": "x",
        "bpm": 180,
        "tailSeconds": 9,
        "chuckSource": VALID_SOURCE
    })
    .to_string();
    let error = StaticValidator::new().validate_json(&invalid).unwrap_err();
    assert!(matches!(error, ValidationError::Schema(_)));
}

#[test]
fn rejects_the_legacy_supercollider_field() {
    let invalid = serde_json::json!({
        "schemaVersion": 1,
        "title": "Legacy",
        "description": "Old source format.",
        "bpm": 60,
        "tailSeconds": 3,
        "supercolliderSource": "SinOsc.ar(440)"
    })
    .to_string();
    assert!(matches!(
        StaticValidator::new().validate_json(&invalid),
        Err(ValidationError::Schema(_))
    ));
}
