use lyra_desktop::music::validator::{AudioValidation, StaticValidator, ValidationError};

const VALID_SOURCE: &str = include_str!("../resources/supercollider/fixtures/valid/deep-space.scd");

fn valid_json() -> String {
    serde_json::json!({
        "schemaVersion": 1,
        "title": "Nebula Drift",
        "description": "A slow spacious focus loop.",
        "bpm": 64,
        "tailSeconds": 4,
        "supercolliderSource": VALID_SOURCE
    })
    .to_string()
}

#[test]
fn validates_schema_and_source_policy_before_spawning_sclang() {
    let validated = StaticValidator::new().validate_json(&valid_json()).unwrap();
    assert_eq!(validated.result.title, "Nebula Drift");
    assert_eq!(validated.source.synth_def_names, vec!["lyra_voice_1"]);
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
        "supercolliderSource": VALID_SOURCE
    })
    .to_string();
    let error = StaticValidator::new().validate_json(&invalid).unwrap_err();
    assert!(matches!(error, ValidationError::Schema(_)));
}

#[test]
fn all_four_theme_fixtures_pass_static_policy() {
    let validator = StaticValidator::new();
    for source in [
        include_str!("../resources/supercollider/fixtures/valid/deep-space.scd"),
        include_str!("../resources/supercollider/fixtures/valid/rainy-cabin.scd"),
        include_str!("../resources/supercollider/fixtures/valid/minimal-pulse.scd"),
        include_str!("../resources/supercollider/fixtures/valid/organic-drift.scd"),
    ] {
        let json = serde_json::json!({
            "schemaVersion": 1,
            "title": "Fixture",
            "description": "Static validation fixture.",
            "bpm": 60,
            "tailSeconds": 3,
            "supercolliderSource": source
        })
        .to_string();
        validator.validate_json(&json).unwrap();
    }
}
