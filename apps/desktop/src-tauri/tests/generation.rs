use lyra_desktop::music::codex_client::{GenerationControls, GenerationPrompt, GenerationTurn};
use lyra_desktop::music::generation::{GenerationBackend, GenerationService};

const VALID_SOURCE: &str = r#"Math.srandom(__LYRA_SEED__);
SinOsc oscillator => ADSR envelope => LPF filter => Pan2 pan => Gain master => dac;
0.12 => master.gain;
while (true) { envelope.keyOn(); 500::ms => now; }"#;

struct FakeBackend {
    outputs: Vec<String>,
    repairs: usize,
}

impl GenerationBackend for FakeBackend {
    fn generate(&mut self, _prompt: &GenerationPrompt) -> Result<GenerationTurn, String> {
        Ok(GenerationTurn {
            thread_id: "thread-1".into(),
            output: self.outputs.remove(0),
        })
    }

    fn repair(
        &mut self,
        _thread_id: &str,
        _prompt: &GenerationPrompt,
        _diagnostics: &str,
    ) -> Result<String, String> {
        self.repairs += 1;
        Ok(self.outputs.remove(0))
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
        outputs: vec![
            json(&VALID_SOURCE.replace("SinOsc", "UnsafeOsc")),
            json(VALID_SOURCE),
        ],
        repairs: 0,
    };
    let mut service = GenerationService::new(backend);
    let draft = service.generate(controls(), false).unwrap();

    assert_eq!(service.backend().repairs, 1);
    assert_eq!(draft.chuck_source, VALID_SOURCE);
    assert_eq!(draft.audio_validation, "pending");
    assert_eq!(draft.arrangement, "ambient");
}

#[test]
fn focus_generation_is_marked_for_deferred_audio_validation() {
    let backend = FakeBackend {
        outputs: vec![json(VALID_SOURCE)],
        repairs: 0,
    };
    let mut service = GenerationService::new(backend);
    let draft = service.generate(controls(), true).unwrap();
    assert_eq!(draft.audio_validation, "deferred_until_focus_ends");
}
