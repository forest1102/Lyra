use lyra_core::{MoodSelection, MusicRecipeV1};
use lyra_desktop::music::codex_client::{GenerationControls, GenerationPrompt, GenerationTurn};
use lyra_desktop::music::generation::{GenerationBackend, GenerationError, GenerationService};
use lyra_desktop::music::validator::StaticValidator;

const VALID_SOURCE: &str = r#"Math.srandom(__LYRA_SEED__);
SinOsc oscillator => ADSR envelope => LPF filter => Pan2 pan => Gain master => dac;
0.12 => master.gain;
while (true) { envelope.keyOn(); 500::ms => now; }"#;

struct FakeBackend {
    initial: Option<Result<String, String>>,
    repair: Option<Result<String, String>>,
    repairs: usize,
}

impl GenerationBackend for FakeBackend {
    fn generate(&mut self, _prompt: &GenerationPrompt) -> Result<GenerationTurn, String> {
        self.initial.take().unwrap().map(|output| GenerationTurn {
            thread_id: "thread-1".into(),
            output,
        })
    }

    fn repair(
        &mut self,
        _thread_id: &str,
        _prompt: &GenerationPrompt,
        _diagnostics: &str,
    ) -> Result<String, String> {
        self.repairs += 1;
        self.repair.take().unwrap()
    }
}

fn json(source: &str) -> String {
    serde_json::json!({
        "schemaVersion": 1,
        "title": "Nebula Drift",
        "description": "A quiet generated focus track.",
        "bpm": 64,
        "tailSeconds": 4,
        "chuckSource": source
    })
    .to_string()
}

fn controls() -> GenerationControls {
    GenerationControls {
        theme: "deep-space".into(),
        arrangement: "ambient".into(),
        brightness: "medium".into(),
        density: "low".into(),
        motion: "low".into(),
    }
}

#[test]
fn repairs_invalid_codex_output_only_once() {
    let backend = FakeBackend {
        initial: Some(Ok(json(&VALID_SOURCE.replace("SinOsc", "UnsafeOsc")))),
        repair: Some(Ok(json(VALID_SOURCE))),
        repairs: 0,
    };
    let mut service = GenerationService::new(backend);
    let mut phases = Vec::new();
    let draft = service
        .generate_with_progress(controls(), false, |phase| phases.push(phase))
        .unwrap();

    assert_eq!(service.backend().repairs, 1);
    assert_eq!(
        phases,
        [
            "composing",
            "source_validating",
            "repairing",
            "source_validating"
        ]
    );
    assert_eq!(draft.chuck_source, VALID_SOURCE);
    assert_eq!(draft.audio_validation, "pending");
    assert_eq!(draft.arrangement, "ambient");
}

#[test]
fn focus_generation_is_marked_for_deferred_audio_validation() {
    let backend = FakeBackend {
        initial: Some(Ok(json(VALID_SOURCE))),
        repair: None,
        repairs: 0,
    };
    let mut service = GenerationService::new(backend);
    let draft = service.generate(controls(), true).unwrap();
    assert_eq!(draft.audio_validation, "deferred_until_focus_ends");
}

#[test]
fn recipe_prompt_contains_normalized_vectors_structure_tempo_and_timbre() {
    let recipe = MusicRecipeV1 {
        version: 1,
        moods: vec![MoodSelection {
            mood_id: "scene-rainy-window".into(),
            weight: 1.0,
        }],
    };
    let prompt = GenerationPrompt::from_recipe(recipe).unwrap();
    let text = prompt.to_string();

    assert!(text.contains("recipeVersion=1"));
    assert!(text.contains("structureFamily="));
    assert!(text.contains("tempoRange="));
    assert!(text.contains("timbreGuidance="));
    assert!(text.contains("space=0.900"));
}

#[test]
fn recipe_generation_reports_real_boundaries_in_order() {
    let recipe = MusicRecipeV1 {
        version: 1,
        moods: vec![MoodSelection {
            mood_id: "scene-rainy-window".into(),
            weight: 1.0,
        }],
    };
    let backend = FakeBackend {
        initial: Some(Ok(json(VALID_SOURCE))),
        repair: None,
        repairs: 0,
    };
    let mut service = GenerationService::new(backend);
    let mut phases = Vec::new();

    service
        .generate_recipe_with_progress(recipe, false, |phase| phases.push(phase))
        .unwrap();

    assert_eq!(phases, ["composing", "source_validating"]);
}

#[test]
fn preserves_initial_backend_error() {
    let backend = FakeBackend {
        initial: Some(Err("initial unavailable".into())),
        repair: None,
        repairs: 0,
    };
    let mut service = GenerationService::new(backend);

    let error = service.generate(controls(), false).unwrap_err();

    assert!(
        matches!(error, GenerationError::Backend(ref message) if message == "initial unavailable")
    );
    assert_eq!(
        error.to_string(),
        "Codex generation failed: initial unavailable"
    );
    assert_eq!(service.backend().repairs, 0);
}

#[test]
fn preserves_repair_backend_error() {
    let invalid = json(&VALID_SOURCE.replace("SinOsc", "UnsafeOsc"));
    let backend = FakeBackend {
        initial: Some(Ok(invalid)),
        repair: Some(Err("repair unavailable".into())),
        repairs: 0,
    };
    let mut service = GenerationService::new(backend);

    let error = service.generate(controls(), false).unwrap_err();

    assert!(
        matches!(error, GenerationError::Backend(ref message) if message == "repair unavailable")
    );
    assert_eq!(
        error.to_string(),
        "Codex generation failed: repair unavailable"
    );
    assert_eq!(service.backend().repairs, 1);
}

#[test]
fn preserves_validation_error_after_one_repair() {
    let invalid = json(&VALID_SOURCE.replace("SinOsc", "UnsafeOsc"));
    let expected = StaticValidator::new()
        .validate_json(&invalid)
        .unwrap_err()
        .to_string();
    let backend = FakeBackend {
        initial: Some(Ok(invalid.clone())),
        repair: Some(Ok(invalid)),
        repairs: 0,
    };
    let mut service = GenerationService::new(backend);

    let error = service.generate(controls(), false).unwrap_err();

    assert!(matches!(error, GenerationError::Validation(ref message) if message == &expected));
    assert_eq!(
        error.to_string(),
        format!("generated source failed validation after one repair: {expected}")
    );
    assert_eq!(service.backend().repairs, 1);
}
