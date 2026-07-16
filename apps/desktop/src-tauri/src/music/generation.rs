use crate::music::codex_client::{
    CodexClient, GenerationControls, GenerationPrompt, GenerationTurn,
};
use crate::music::validator::{AudioValidation, StaticValidator, ValidatedGeneration};
use lyra_core::MusicRecipeV1;
use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

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
    pub recipe_version: Option<i64>,
    pub recipe_json: Option<String>,
    pub structure_family: String,
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
        self.generate_with_progress(controls, focus_active, |_| {})
    }

    pub fn generate_with_progress<F>(
        &mut self,
        controls: GenerationControls,
        focus_active: bool,
        on_progress: F,
    ) -> Result<GeneratedMusicDraft, GenerationError>
    where
        F: FnMut(&'static str),
    {
        let prompt = GenerationPrompt::new(controls);
        self.generate_prompt(prompt, focus_active, on_progress)
    }

    pub fn generate_recipe(
        &mut self,
        recipe: MusicRecipeV1,
        focus_active: bool,
    ) -> Result<GeneratedMusicDraft, GenerationError> {
        self.generate_recipe_with_progress(recipe, focus_active, |_| {})
    }

    pub fn generate_recipe_with_progress<F>(
        &mut self,
        recipe: MusicRecipeV1,
        focus_active: bool,
        on_progress: F,
    ) -> Result<GeneratedMusicDraft, GenerationError>
    where
        F: FnMut(&'static str),
    {
        let prompt = GenerationPrompt::from_recipe(recipe)
            .map_err(|error| GenerationError::Validation(error.to_string()))?;
        self.generate_prompt(prompt, focus_active, on_progress)
    }

    fn generate_prompt<F>(
        &mut self,
        prompt: GenerationPrompt,
        focus_active: bool,
        mut on_progress: F,
    ) -> Result<GeneratedMusicDraft, GenerationError>
    where
        F: FnMut(&'static str),
    {
        let controls = prompt.controls().clone();
        let recipe_version = prompt.resolved_recipe().map(|_| 1);
        let recipe_json = prompt.resolved_recipe().map(|resolved| {
            serde_json::to_string(&resolved.recipe).expect("resolved recipe is serializable")
        });
        let structure_family = prompt
            .resolved_recipe()
            .map(|resolved| resolved.structure_family.clone())
            .unwrap_or_else(|| controls.arrangement.clone());
        on_progress("composing");
        let turn = self
            .backend
            .generate(&prompt)
            .map_err(GenerationError::Backend)?;
        on_progress("source_validating");
        let validated = match self.validate(&turn.output, focus_active) {
            Ok(validated) => Ok(validated),
            Err(first_error) => {
                on_progress("repairing");
                let repaired = self
                    .backend
                    .repair(&turn.thread_id, &prompt, &first_error)
                    .map_err(GenerationError::Backend)?;
                on_progress("source_validating");
                self.validate(&repaired, focus_active)
                    .map_err(GenerationError::Validation)
            }
        }?;

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
            recipe_version,
            recipe_json,
            structure_family,
        })
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
