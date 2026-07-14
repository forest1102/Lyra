use crate::music::source_policy::{SourcePolicy, SourcePolicyError, SourceValidation};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use thiserror::Error;

const MAX_SOURCE_BYTES: usize = 48 * 1024;
const SCLANG_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MusicGenerationResultV1 {
    pub schema_version: u8,
    pub title: String,
    pub description: String,
    pub bpm: f64,
    pub tail_seconds: f64,
    pub supercollider_source: String,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SclangValidationReport {
    pub synth_def_bytes: Vec<usize>,
    pub events_evaluated: usize,
    pub min_duration: f64,
    pub max_duration: f64,
    pub min_amplitude: f64,
    pub max_amplitude: f64,
}

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("schema validation failed: {0}")]
    Schema(String),
    #[error("source policy failed: {0}")]
    SourcePolicy(#[from] SourcePolicyError),
    #[error("failed to start isolated sclang: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("isolated sclang timed out after 5 seconds")]
    Timeout,
    #[error("isolated sclang failed: {0}")]
    Sclang(String),
    #[error("isolated sclang returned no validation report")]
    MissingReport,
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
        let source = self.source_policy.validate(&result.supercollider_source)?;
        Ok(ValidatedGeneration {
            result,
            source,
            audio_validation,
        })
    }

    pub fn validate_with_sclang(
        &self,
        sclang: &Path,
        language_config: &Path,
        validator_script: &Path,
        track_path: &Path,
    ) -> Result<SclangValidationReport, ValidationError> {
        let workspace = ValidationWorkspace::new()?;
        let writable_root = workspace.path().to_string_lossy();
        let profile = format!(
            "(version 1)\n(deny default)\n(allow process-exec)\n(allow process-fork)\n(allow file-read*)\n(allow file-write* (subpath \"{writable_root}\"))\n(allow network* (local ip))\n(allow network-outbound (remote ip \"localhost:*\"))\n(allow sysctl-read (sysctl-name-prefix \"net.routetable.\"))\n(allow system-socket)\n(allow socket-ioctl)"
        );
        let mut child = Command::new("/usr/bin/sandbox-exec")
            .arg("-p")
            .arg(&profile)
            .arg(sclang)
            .arg("-D")
            .arg("-l")
            .arg(language_config)
            .arg(validator_script)
            .env("LYRA_TRACK_PATH", track_path)
            .env("HOME", workspace.home())
            .env("XDG_CONFIG_HOME", workspace.config())
            .env("XDG_DATA_HOME", workspace.data())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let started = Instant::now();
        loop {
            if child.try_wait()?.is_some() {
                break;
            }
            if started.elapsed() >= SCLANG_TIMEOUT {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ValidationError::Timeout);
            }
            thread::sleep(Duration::from_millis(20));
        }
        let output = child.wait_with_output()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(ValidationError::Sclang(format!(
                "{}{}",
                stdout.trim(),
                stderr.trim()
            )));
        }
        let report = stdout
            .lines()
            .find_map(|line| line.strip_prefix("LYRA_VALIDATION:"))
            .ok_or(ValidationError::MissingReport)?;
        serde_json::from_str(report).map_err(|error| ValidationError::Sclang(error.to_string()))
    }
}

struct ValidationWorkspace {
    root: PathBuf,
    home: PathBuf,
    config: PathBuf,
    data: PathBuf,
}

impl ValidationWorkspace {
    fn new() -> Result<Self, std::io::Error> {
        let root = std::env::temp_dir().join(format!("lyra-validation-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let config = root.join("config");
        let data = root.join("data");
        for directory in [
            &home,
            &config,
            &data,
            &config.join("SuperCollider/synthdefs"),
            &data.join("SuperCollider"),
        ] {
            std::fs::create_dir_all(directory)?;
        }
        let root = root.canonicalize()?;
        Ok(Self {
            home,
            config,
            data,
            root,
        })
    }

    fn path(&self) -> &Path {
        &self.root
    }

    fn home(&self) -> &Path {
        &self.home
    }

    fn config(&self) -> &Path {
        &self.config
    }

    fn data(&self) -> &Path {
        &self.data
    }
}

impl Drop for ValidationWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn validate_metadata(result: &MusicGenerationResultV1) -> Result<(), ValidationError> {
    if result.schema_version != 1 {
        return Err(ValidationError::Schema("schemaVersion must be 1".into()));
    }
    let title_length = result.title.chars().count();
    if !(1..=60).contains(&title_length) {
        return Err(ValidationError::Schema(
            "title must contain 1 to 60 characters".into(),
        ));
    }
    let description_length = result.description.chars().count();
    if !(1..=240).contains(&description_length) {
        return Err(ValidationError::Schema(
            "description must contain 1 to 240 characters".into(),
        ));
    }
    if !(40.0..=120.0).contains(&result.bpm) || !result.bpm.is_finite() {
        return Err(ValidationError::Schema(
            "bpm must be between 40 and 120".into(),
        ));
    }
    if !(0.0..=8.0).contains(&result.tail_seconds) || !result.tail_seconds.is_finite() {
        return Err(ValidationError::Schema(
            "tailSeconds must be between 0 and 8".into(),
        ));
    }
    if result.supercollider_source.len() > MAX_SOURCE_BYTES {
        return Err(ValidationError::Schema(
            "supercolliderSource exceeds 48 KiB".into(),
        ));
    }
    Ok(())
}
