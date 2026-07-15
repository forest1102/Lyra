use crate::music::codex_client::{resolve_codex_binary, CodexClient, GenerationControls};
use crate::music::generation::{GeneratedMusicDraft, GenerationService};
use crate::music::track_store::TrackStore;
use lyra_core::{
    AddTask, Database, FocusSession, MusicTrackRecord, Task, TaskList, TimerAction, TimerEngine,
    TimerPhase, TimerPreset, TimerState, TimerStatus,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, AppHandle, Manager, State};

pub struct NativePaths {
    pub data_directory: PathBuf,
    pub track_directory: PathBuf,
    pub generation_directory: PathBuf,
}

impl NativePaths {
    pub fn new(data_directory: PathBuf) -> Self {
        Self {
            track_directory: data_directory.join("tracks"),
            generation_directory: data_directory.join("generation"),
            data_directory,
        }
    }

    pub fn cleanup_legacy_audio(&self) -> std::io::Result<()> {
        let legacy_runtime = self.data_directory.join("supercollider");
        if legacy_runtime.exists() {
            std::fs::remove_dir_all(legacy_runtime)?;
        }
        for directory in [&self.track_directory, &self.generation_directory] {
            let Ok(entries) = std::fs::read_dir(directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|extension| extension == "scd") {
                    std::fs::remove_file(path)?;
                }
            }
        }
        Ok(())
    }
}

pub struct AppState {
    pub database: Mutex<Database>,
    pub timer: Mutex<TimerEngine>,
    pub generation: Mutex<Option<GenerationService<CodexClient>>>,
    pub generation_active: Arc<AtomicBool>,
    pub generation_cancellation: Arc<AtomicBool>,
    pub drafts: Mutex<HashMap<String, GeneratedMusicDraft>>,
    pub paths: NativePaths,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicGenerationProgress {
    phase: String,
}

impl MusicGenerationProgress {
    pub(crate) fn new(phase: impl Into<String>) -> Self {
        Self {
            phase: phase.into(),
        }
    }
}

fn send_generation_progress(channel: &Channel<MusicGenerationProgress>, phase: &str) {
    let _ = channel.send(MusicGenerationProgress::new(phase));
}

fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

#[tauri::command]
pub fn list_tasks(state: State<'_, AppState>) -> Result<Vec<Task>, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .list_tasks(None)
        .map_err(error)
}

fn read_timer_state(timer: &Mutex<TimerEngine>) -> Result<TimerState, String> {
    Ok(timer.lock().map_err(error)?.state())
}

#[tauri::command]
pub fn get_timer_state(state: State<'_, AppState>) -> Result<TimerState, String> {
    read_timer_state(&state.timer)
}

#[cfg(test)]
mod timer_state_tests {
    use super::read_timer_state;
    use lyra_core::{TimerEngine, TimerPreset, TimerStatus};
    use std::sync::Mutex;

    #[test]
    fn reads_the_current_rust_timer_state() {
        let timer = Mutex::new(TimerEngine::new(TimerPreset {
            id: "standard".into(),
            name: "Standard".into(),
            focus_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            cycles_before_long_break: 4,
            built_in: true,
        }));

        let state = read_timer_state(&timer).expect("timer state");

        assert_eq!(state.status, TimerStatus::Idle);
        assert_eq!(state.remaining_seconds, 1_500);
    }
}

#[tauri::command]
pub fn add_task(input: AddTask, state: State<'_, AppState>) -> Result<Task, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .add_task(input)
        .map_err(error)
}

#[tauri::command]
pub fn set_task_completed(
    id: String,
    completed: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .database
        .lock()
        .map_err(error)?
        .set_task_completed(&id, completed)
        .map_err(error)
}

#[tauri::command]
pub fn move_task(id: String, list: TaskList, state: State<'_, AppState>) -> Result<(), String> {
    state
        .database
        .lock()
        .map_err(error)?
        .move_task(&id, list)
        .map_err(error)
}

#[tauri::command]
pub fn list_timer_presets(state: State<'_, AppState>) -> Result<Vec<TimerPreset>, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .list_timer_presets()
        .map_err(error)
}

#[tauri::command]
pub fn save_timer_preset(
    preset: TimerPreset,
    state: State<'_, AppState>,
) -> Result<TimerPreset, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .save_timer_preset(preset)
        .map_err(error)
}

#[tauri::command]
pub fn list_music_tracks(state: State<'_, AppState>) -> Result<Vec<MusicTrackRecord>, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .list_music_tracks()
        .map_err(error)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateMusicRequest {
    theme: String,
    arrangement: String,
    brightness: String,
    density: String,
    motion: String,
}

#[tauri::command]
pub async fn generate_music(
    request: GenerateMusicRequest,
    on_progress: Channel<MusicGenerationProgress>,
    app: AppHandle,
) -> Result<GeneratedMusicDraft, String> {
    let generation_active = app.state::<AppState>().generation_active.clone();
    generation_active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "BGMはすでに生成中です".to_string())?;
    app.state::<AppState>()
        .generation_cancellation
        .store(false, Ordering::Release);
    send_generation_progress(&on_progress, "started");
    let result = tauri::async_runtime::spawn_blocking(move || {
        send_generation_progress(&on_progress, "coding");
        let state = app.state::<AppState>();
        generate_music_blocking(request, &state)
    })
    .await;
    generation_active.store(false, Ordering::Release);
    result.map_err(error)?
}

#[tauri::command]
pub fn cancel_music_generation(state: State<'_, AppState>) {
    state.generation_cancellation.store(true, Ordering::Release);
}

fn generate_music_blocking(
    request: GenerateMusicRequest,
    state: &AppState,
) -> Result<GeneratedMusicDraft, String> {
    validate_control(
        "theme",
        &request.theme,
        &[
            "deep-space",
            "rainy-cabin",
            "minimal-pulse",
            "organic-drift",
        ],
    )?;
    validate_control(
        "brightness",
        &request.brightness,
        &["low", "medium", "high"],
    )?;
    validate_music_arrangement(&request.arrangement)?;
    validate_control("density", &request.density, &["low", "medium", "high"])?;
    validate_control("motion", &request.motion, &["low", "medium", "high"])?;
    let focus_active = {
        let timer = state.timer.lock().map_err(error)?.state();
        timer.status == TimerStatus::Running && timer.phase == TimerPhase::Focus
    };
    let mut generation = state.generation.lock().map_err(error)?;
    if generation.is_none() {
        let client = CodexClient::start(
            resolve_codex_binary(),
            state.paths.generation_directory.clone(),
            state.generation_cancellation.clone(),
        )
        .map_err(error)?;
        *generation = Some(GenerationService::new(client));
    }
    let generated = generation
        .as_mut()
        .expect("generation service was initialized")
        .generate(
            GenerationControls {
                theme: request.theme,
                arrangement: request.arrangement,
                brightness: request.brightness,
                density: request.density,
                motion: request.motion,
            },
            focus_active,
        );
    let draft = match generated {
        Ok(draft) => draft,
        Err(generation_error) => {
            *generation = None;
            return Err(error(generation_error));
        }
    };
    state
        .drafts
        .lock()
        .map_err(error)?
        .insert(draft.id.clone(), draft.clone());
    Ok(draft)
}

#[tauri::command]
pub fn save_music_draft(
    draft_id: String,
    state: State<'_, AppState>,
) -> Result<MusicTrackRecord, String> {
    let draft = state
        .drafts
        .lock()
        .map_err(error)?
        .remove(&draft_id)
        .ok_or_else(|| "music draft was not found".to_string())?;
    if draft.audio_validation != "passed" {
        state
            .drafts
            .lock()
            .map_err(error)?
            .insert(draft.id.clone(), draft);
        return Err("audio validation and preview must pass before saving".into());
    }
    let database = state.database.lock().map_err(error)?;
    TrackStore::new(&database, &state.paths.track_directory)
        .save_draft(draft)
        .map_err(error)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftValidationReport {
    pub duration_ms: u64,
    pub elapsed_audio_seconds: f64,
    pub peak: f64,
    pub non_silent_ms: u64,
    pub non_finite_samples: u64,
    pub processor_errors: u64,
}

fn validate_audio_report(report: &DraftValidationReport) -> Result<(), String> {
    if report.duration_ms != 5_000
        || !report.elapsed_audio_seconds.is_finite()
        || report.elapsed_audio_seconds < 4.9
        || !report.peak.is_finite()
        || !(0.0..=1.0).contains(&report.peak)
        || report.non_silent_ms < 250
        || report.non_finite_samples != 0
        || report.processor_errors != 0
    {
        return Err("WebChucK audio validation report did not meet the safety thresholds".into());
    }
    Ok(())
}

#[tauri::command]
pub fn confirm_music_draft_validation(
    draft_id: String,
    report: DraftValidationReport,
    state: State<'_, AppState>,
) -> Result<GeneratedMusicDraft, String> {
    validate_audio_report(&report)?;
    let mut drafts = state.drafts.lock().map_err(error)?;
    let draft = drafts
        .get_mut(&draft_id)
        .ok_or_else(|| "music draft was not found".to_string())?;
    draft.audio_validation = "passed".into();
    Ok(draft.clone())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrackSource {
    pub chuck_source: String,
    pub source_sha256: String,
}

#[tauri::command]
pub fn get_music_track_source(
    track_id: String,
    state: State<'_, AppState>,
) -> Result<MusicTrackSource, String> {
    let database = state.database.lock().map_err(error)?;
    let track = database
        .get_music_track(&track_id)
        .map_err(error)?
        .ok_or_else(|| "track was not found".to_string())?;
    TrackStore::new(&database, &state.paths.track_directory)
        .verify(&track)
        .map_err(error)?;
    let chuck_source = std::fs::read_to_string(&track.source_path).map_err(error)?;
    Ok(MusicTrackSource {
        chuck_source,
        source_sha256: track.source_sha256,
    })
}

#[tauri::command]
pub fn save_variation(
    track_id: String,
    seed: i64,
    state: State<'_, AppState>,
) -> Result<MusicTrackRecord, String> {
    let database = state.database.lock().map_err(error)?;
    let parent = database
        .get_music_track(&track_id)
        .map_err(error)?
        .ok_or_else(|| "parent track was not found".to_string())?;
    TrackStore::new(&database, &state.paths.track_directory)
        .save_variation(&parent, seed)
        .map_err(error)
}

#[tauri::command]
pub fn rate_music_track(
    id: String,
    rating: Option<String>,
    favorite: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .database
        .lock()
        .map_err(error)?
        .rate_music_track(&id, rating.as_deref(), favorite)
        .map_err(error)
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum TimerEventInput {
    SelectPreset,
    Start { now_ms: u64 },
    Tick { now_ms: u64 },
    Pause { now_ms: u64 },
    Resume { now_ms: u64 },
    StartBreak { now_ms: u64 },
    End { now_ms: u64 },
}

impl TimerEventInput {
    fn parts(self) -> (TimerAction, u64) {
        match self {
            Self::SelectPreset => unreachable!("preset selection is handled before timer actions"),
            Self::Start { now_ms } => (TimerAction::Start, now_ms),
            Self::Tick { now_ms } => (TimerAction::Tick, now_ms),
            Self::Pause { now_ms } => (TimerAction::Pause, now_ms),
            Self::Resume { now_ms } => (TimerAction::Resume, now_ms),
            Self::StartBreak { now_ms } => (TimerAction::StartBreak, now_ms),
            Self::End { now_ms } => (TimerAction::End, now_ms),
        }
    }
}

pub(crate) fn timer_dispatch_event(
    event: TimerEventInput,
    preset_id: Option<String>,
    state: &AppState,
) -> Result<TimerState, String> {
    if matches!(&event, TimerEventInput::SelectPreset) {
        let preset_id = preset_id.ok_or_else(|| "presetId is required".to_string())?;
        let mut timer = state.timer.lock().map_err(error)?;
        let current = timer.state();
        if !matches!(current.status, TimerStatus::Idle | TimerStatus::Completed) {
            return Err("timer preset can only be selected while idle".into());
        }
        *timer = TimerEngine::new(find_preset(state, &preset_id)?);
        return Ok(timer.state());
    }
    let (action, now_ms) = event.parts();
    let mut timer = state.timer.lock().map_err(error)?;
    if action == TimerAction::Start {
        if let Some(preset_id) = preset_id {
            let current = timer.state();
            if matches!(current.status, TimerStatus::Idle | TimerStatus::Completed) {
                let preset = find_preset(state, &preset_id)?;
                *timer = TimerEngine::new(preset);
            }
        }
    }
    timer.dispatch(action, now_ms).map_err(error)
}

fn find_preset(state: &AppState, id: &str) -> Result<TimerPreset, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .list_timer_presets()
        .map_err(error)?
        .into_iter()
        .find(|preset| preset.id == id)
        .ok_or_else(|| format!("timer preset not found: {id}"))
}

#[tauri::command]
pub fn start_focus(
    task_ids: Vec<String>,
    preset_id: String,
    music_track_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<FocusSession, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .start_focus_session(&task_ids, &preset_id, music_track_id.as_deref())
        .map_err(error)
}

#[tauri::command]
pub fn finish_focus(
    session_id: String,
    elapsed_seconds: i64,
    completed_task_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .database
        .lock()
        .map_err(error)?
        .complete_focus_session(&session_id, elapsed_seconds, &completed_task_ids)
        .map_err(error)
}

fn validate_control(name: &str, value: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("invalid {name}: {value}"))
    }
}

fn validate_music_arrangement(value: &str) -> Result<(), String> {
    validate_control("arrangement", value, &["ambient", "lofi", "minimal-melody"])
}

#[cfg(test)]
mod tests {
    use super::{validate_audio_report, validate_music_arrangement, DraftValidationReport};

    #[test]
    fn accepts_only_supported_music_arrangements() {
        for arrangement in ["ambient", "lofi", "minimal-melody"] {
            assert!(validate_music_arrangement(arrangement).is_ok());
        }
        assert!(validate_music_arrangement("cinematic-horror").is_err());
    }

    #[test]
    fn rechecks_client_audio_validation_thresholds() {
        let valid = DraftValidationReport {
            duration_ms: 5_000,
            elapsed_audio_seconds: 4.9,
            peak: 1.0,
            non_silent_ms: 250,
            non_finite_samples: 0,
            processor_errors: 0,
        };
        assert!(validate_audio_report(&valid).is_ok());

        let unsafe_peak = DraftValidationReport {
            peak: 1.01,
            ..valid
        };
        assert!(validate_audio_report(&unsafe_peak).is_err());
    }
}
