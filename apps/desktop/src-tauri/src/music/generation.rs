use crate::music::codex_client::{
    CodexClient, GenerationControls, GenerationPrompt, GenerationTurn, MUSIC_GENERATION_MODEL,
};
use crate::music::validator::{AudioValidation, StaticValidator, ValidatedGeneration};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::time::Instant;
use thiserror::Error;
use uuid::Uuid;

#[derive(Default)]
struct GenerationMetrics {
    initial_ms: u128,
    validation_ms: u128,
    repair_ms: u128,
    repaired: bool,
    total_ms: u128,
}

fn format_generation_metrics(metrics: &GenerationMetrics, success: bool) -> String {
    format!(
        "music_generation model={} initial_ms={} validation_ms={} repair_ms={} repaired={} total_ms={} result={}",
        MUSIC_GENERATION_MODEL,
        metrics.initial_ms,
        metrics.validation_ms,
        metrics.repair_ms,
        metrics.repaired,
        metrics.total_ms,
        if success { "success" } else { "failure" }
    )
}

pub trait GenerationBackend {
    fn generate(&mut self, prompt: &GenerationPrompt) -> Result<GenerationTurn, String>;
    fn repair(
        &mut self,
        thread_id: &str,
        prompt: &GenerationPrompt,
        diagnostics: &str,
    ) -> Result<String, String>;
}

impl GenerationBackend for CodexClient {
    fn generate(&mut self, prompt: &GenerationPrompt) -> Result<GenerationTurn, String> {
        CodexClient::generate(self, prompt).map_err(|error| error.to_string())
    }

    fn repair(
        &mut self,
        thread_id: &str,
        prompt: &GenerationPrompt,
        diagnostics: &str,
    ) -> Result<String, String> {
        CodexClient::repair(self, thread_id, prompt, diagnostics).map_err(|error| error.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedMusicDraft {
    pub id: String,
    pub parent_track_id: Option<String>,
    pub title: String,
    pub description: String,
    pub theme: String,
    pub arrangement: String,
    pub brightness: String,
    pub density: String,
    pub motion: String,
    pub bpm: f64,
    pub tail_seconds: f64,
    pub chuck_source: String,
    pub source_sha256: String,
    pub canonical_seed: i64,
    pub audio_validation: String,
}

#[derive(Debug, Error)]
pub enum GenerationError {
    #[error("Codex generation failed: {0}")]
    Backend(String),
    #[error("generated source failed validation after one repair: {0}")]
    Validation(String),
}

pub struct GenerationService<B> {
    backend: B,
    validator: StaticValidator,
}

impl<B: GenerationBackend> GenerationService<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            validator: StaticValidator::new(),
        }
    }

    pub fn backend(&self) -> &B {
        &self.backend
    }

    pub fn generate(
        &mut self,
        controls: GenerationControls,
        focus_active: bool,
    ) -> Result<GeneratedMusicDraft, GenerationError> {
        self.generate_with_reporter(controls, focus_active, |record| eprintln!("{record}"))
    }

    fn generate_with_reporter(
        &mut self,
        controls: GenerationControls,
        focus_active: bool,
        reporter: impl FnOnce(&str),
    ) -> Result<GeneratedMusicDraft, GenerationError> {
        let total_started = Instant::now();
        let mut metrics = GenerationMetrics::default();
        let result = (|| {
            let prompt = GenerationPrompt::new(controls.clone());
            let initial_started = Instant::now();
            let turn = self.backend.generate(&prompt);
            metrics.initial_ms = initial_started.elapsed().as_millis();
            let turn = turn.map_err(GenerationError::Backend)?;

            let validation_started = Instant::now();
            let first_validation = self.validate(&turn.output, focus_active);
            metrics.validation_ms = validation_started.elapsed().as_millis();
            let validated = match first_validation {
                Ok(validated) => validated,
                Err(first_error) => {
                    metrics.repaired = true;
                    let repair_started = Instant::now();
                    let repaired = self.backend.repair(&turn.thread_id, &prompt, &first_error);
                    metrics.repair_ms = repair_started.elapsed().as_millis();
                    let repaired = repaired.map_err(GenerationError::Backend)?;

                    let validation_started = Instant::now();
                    let repaired_validation = self.validate(&repaired, focus_active);
                    metrics.validation_ms += validation_started.elapsed().as_millis();
                    repaired_validation.map_err(GenerationError::Validation)?
                }
            };

            let id = Uuid::new_v4();
            let chuck_source = validated.result.chuck_source;
            let source_sha256 = format!("{:x}", Sha256::digest(chuck_source.as_bytes()));
            let canonical_seed = (id.as_u128() as u64 & i64::MAX as u64) as i64;
            Ok(GeneratedMusicDraft {
                id: id.to_string(),
                parent_track_id: None,
                title: validated.result.title,
                description: validated.result.description,
                theme: controls.theme,
                arrangement: controls.arrangement,
                brightness: controls.brightness,
                density: controls.density,
                motion: controls.motion,
                bpm: validated.result.bpm,
                tail_seconds: validated.result.tail_seconds,
                chuck_source,
                source_sha256,
                canonical_seed,
                audio_validation: match validated.audio_validation {
                    AudioValidation::Required => "pending",
                    AudioValidation::DeferredUntilFocusEnds => "deferred_until_focus_ends",
                }
                .into(),
            })
        })();
        metrics.total_ms = total_started.elapsed().as_millis();
        reporter(&format_generation_metrics(&metrics, result.is_ok()));
        result
    }

    fn validate(&self, output: &str, focus_active: bool) -> Result<ValidatedGeneration, String> {
        let result = if focus_active {
            self.validator.validate_json_during_focus(output)
        } else {
            self.validator.validate_json(output)
        };
        result.map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        format_generation_metrics, GeneratedMusicDraft, GenerationBackend, GenerationError,
        GenerationMetrics, GenerationService,
    };
    use crate::music::codex_client::{GenerationControls, GenerationPrompt, GenerationTurn};

    const VALID_SOURCE: &str = r#"Math.srandom(__LYRA_SEED__);
SinOsc oscillator => ADSR envelope => LPF filter => Pan2 pan => Gain master => dac;
0.12 => master.gain;
while (true) { envelope.keyOn(); 500::ms => now; }"#;

    struct FakeBackend {
        initial: Option<Result<String, String>>,
        repair: Option<Result<String, String>>,
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

    fn generate_with_records(
        backend: FakeBackend,
    ) -> (Result<GeneratedMusicDraft, GenerationError>, Vec<String>) {
        let mut service = GenerationService::new(backend);
        let mut records = Vec::new();
        let result = service.generate_with_reporter(controls(), false, |record| {
            records.push(record.to_owned());
        });
        (result, records)
    }

    #[test]
    fn formats_success_metrics_with_stable_field_order() {
        let metrics = GenerationMetrics {
            initial_ms: 12,
            validation_ms: 34,
            repair_ms: 56,
            repaired: true,
            total_ms: 78,
        };

        assert_eq!(
            format_generation_metrics(&metrics, true),
            "music_generation model=gpt-5.6-terra initial_ms=12 validation_ms=34 repair_ms=56 repaired=true total_ms=78 result=success"
        );
    }

    #[test]
    fn formats_failure_metrics_without_repair() {
        let metrics = GenerationMetrics {
            initial_ms: 1,
            validation_ms: 2,
            repair_ms: 0,
            repaired: false,
            total_ms: 3,
        };

        assert_eq!(
            format_generation_metrics(&metrics, false),
            "music_generation model=gpt-5.6-terra initial_ms=1 validation_ms=2 repair_ms=0 repaired=false total_ms=3 result=failure"
        );
    }

    #[test]
    fn reports_success_exactly_once() {
        let (result, records) = generate_with_records(FakeBackend {
            initial: Some(Ok(json(VALID_SOURCE))),
            repair: None,
        });

        assert!(result.is_ok());
        assert_eq!(records.len(), 1);
        assert!(records[0].contains("repaired=false"));
        assert!(records[0].contains("result=success"));
    }

    #[test]
    fn reports_initial_backend_failure_exactly_once() {
        let (result, records) = generate_with_records(FakeBackend {
            initial: Some(Err("initial unavailable".into())),
            repair: None,
        });

        assert!(matches!(result, Err(GenerationError::Backend(_))));
        assert_eq!(records.len(), 1);
        assert!(records[0].contains("repaired=false"));
        assert!(records[0].contains("result=failure"));
    }

    #[test]
    fn reports_repair_backend_failure_exactly_once() {
        let invalid = json(&VALID_SOURCE.replace("SinOsc", "UnsafeOsc"));
        let (result, records) = generate_with_records(FakeBackend {
            initial: Some(Ok(invalid)),
            repair: Some(Err("repair unavailable".into())),
        });

        assert!(matches!(result, Err(GenerationError::Backend(_))));
        assert_eq!(records.len(), 1);
        assert!(records[0].contains("repaired=true"));
        assert!(records[0].contains("result=failure"));
    }

    #[test]
    fn reports_final_validation_failure_exactly_once() {
        let invalid = json(&VALID_SOURCE.replace("SinOsc", "UnsafeOsc"));
        let (result, records) = generate_with_records(FakeBackend {
            initial: Some(Ok(invalid.clone())),
            repair: Some(Ok(invalid)),
        });

        assert!(matches!(result, Err(GenerationError::Validation(_))));
        assert_eq!(records.len(), 1);
        assert!(records[0].contains("repaired=true"));
        assert!(records[0].contains("result=failure"));
    }
}
