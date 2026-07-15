use crate::music::source_policy::{SourcePolicy, SourcePolicyError, SourceValidation};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_SOURCE_BYTES: usize = 48 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MusicGenerationResultV1 {
    pub schema_version: u8,
    pub title: String,
    pub description: String,
    pub bpm: f64,
    pub tail_seconds: f64,
    pub chuck_source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioValidation {
    Required,
    DeferredUntilFocusEnds,
}

#[derive(Debug, Clone)]
pub struct ValidatedGeneration {
    pub result: MusicGenerationResultV1,
    pub source: SourceValidation,
    pub audio_validation: AudioValidation,
}

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("schema validation failed: {0}")]
    Schema(String),
    #[error("source policy failed: {0}")]
    SourcePolicy(#[from] SourcePolicyError),
}

pub struct StaticValidator {
    source_policy: SourcePolicy,
}

impl Default for StaticValidator {
    fn default() -> Self {
        Self::new()
    }
}

impl StaticValidator {
    pub fn new() -> Self {
        Self {
            source_policy: SourcePolicy::v1(),
        }
    }

    pub fn validate_json(&self, json: &str) -> Result<ValidatedGeneration, ValidationError> {
        self.validate_json_with_audio_state(json, AudioValidation::Required)
    }

    pub fn validate_json_during_focus(
        &self,
        json: &str,
    ) -> Result<ValidatedGeneration, ValidationError> {
        self.validate_json_with_audio_state(json, AudioValidation::DeferredUntilFocusEnds)
    }

    fn validate_json_with_audio_state(
        &self,
        json: &str,
        audio_validation: AudioValidation,
    ) -> Result<ValidatedGeneration, ValidationError> {
        let result: MusicGenerationResultV1 = serde_json::from_str(json)
            .map_err(|error| ValidationError::Schema(error.to_string()))?;
        validate_metadata(&result)?;
        let source = self.source_policy.validate(&result.chuck_source)?;
        Ok(ValidatedGeneration {
            result,
            source,
            audio_validation,
        })
    }
}

fn validate_metadata(result: &MusicGenerationResultV1) -> Result<(), ValidationError> {
    if result.schema_version != 1 {
        return Err(ValidationError::Schema("schemaVersion must be 1".into()));
    }
    if !(1..=60).contains(&result.title.chars().count()) {
        return Err(ValidationError::Schema(
            "title must contain 1 to 60 characters".into(),
        ));
    }
    if !(1..=240).contains(&result.description.chars().count()) {
        return Err(ValidationError::Schema(
            "description must contain 1 to 240 characters".into(),
        ));
    }
    if !result.bpm.is_finite() || !(40.0..=120.0).contains(&result.bpm) {
        return Err(ValidationError::Schema(
            "bpm must be between 40 and 120".into(),
        ));
    }
    if !result.tail_seconds.is_finite() || !(0.0..=8.0).contains(&result.tail_seconds) {
        return Err(ValidationError::Schema(
            "tailSeconds must be between 0 and 8".into(),
        ));
    }
    if result.chuck_source.len() > MAX_SOURCE_BYTES {
        return Err(ValidationError::Schema("chuckSource exceeds 48 KiB".into()));
    }
    Ok(())
}
