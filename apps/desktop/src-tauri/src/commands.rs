use crate::music::codex_client::{resolve_codex_binary, CodexClient, GenerationControls};
use crate::music::generation::{GeneratedMusicDraft, GenerationService};
use crate::music::runtime::{MusicRuntimeConfig, SuperColliderRuntime};
use crate::music::track_store::TrackStore;
use crate::music::validator::StaticValidator;
use lyra_core::{
    AddTask, Database, FocusSession, MusicTrackRecord, Task, TaskList, TimerAction, TimerEngine,
    TimerPhase, TimerPreset, TimerState, TimerStatus,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct NativePaths {
    pub data_directory: PathBuf,
    pub track_directory: PathBuf,
    pub generation_directory: PathBuf,
    pub supercollider_directory: PathBuf,
}

impl NativePaths {
    pub fn new(data_directory: PathBuf, supercollider_directory: PathBuf) -> Self {
        Self {
            track_directory: data_directory.join("tracks"),
            generation_directory: data_directory.join("generation"),
            data_directory,
            supercollider_directory,
        }
    }

    pub(crate) fn runtime_config(&self) -> MusicRuntimeConfig {
        let app = PathBuf::from("/Applications/SuperCollider.app");
        let local_sclang = self.data_directory.join("supercollider/runtime/sclang");
        let default_sclang = if local_sclang.is_file() {
            local_sclang
        } else {
            app.join("Contents/MacOS/sclang")
        };
        MusicRuntimeConfig {
            sclang_path: std::env::var_os("LYRA_SCLANG_PATH")
                .map(PathBuf::from)
                .unwrap_or(default_sclang),
            scsynth_path: std::env::var_os("LYRA_SCSYNTH_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| app.join("Contents/Resources/scsynth")),
            plugin_path: std::env::var_os("LYRA_SC_PLUGIN_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| app.join("Contents/Resources/plugins")),
            language_config: self.supercollider_directory.join("sclang_conf.yaml"),
            bootstrap_script: self.supercollider_directory.join("bootstrap.scd"),
            xdg_config_home: self.data_directory.join("supercollider/config"),
            xdg_data_home: self.data_directory.join("supercollider/data"),
        }
    }
}

pub struct AppState {
    pub database: Mutex<Database>,
    pub timer: Mutex<TimerEngine>,
    pub generation: Mutex<Option<GenerationService<CodexClient>>>,
    pub drafts: Mutex<HashMap<String, GeneratedMusicDraft>>,
    pub runtime: Mutex<Option<SuperColliderRuntime>>,
    pub music_disabled_session: Mutex<bool>,
    pub paths: NativePaths,
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
    brightness: String,
    density: String,
    motion: String,
}

#[tauri::command]
pub async fn generate_music(
    request: GenerateMusicRequest,
    app: AppHandle,
) -> Result<GeneratedMusicDraft, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        generate_music_blocking(request, &state)
    })
    .await
    .map_err(error)?
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
    validate_control("density", &request.density, &["low", "medium", "high"])?;
    validate_control("motion", &request.motion, &["low", "medium", "high"])?;
    let focus_active = {
        let timer = state.timer.lock().map_err(error)?.state();
        timer.status == TimerStatus::Running && timer.phase == TimerPhase::Focus
    };
    let mut generation = state
        .generation
        .try_lock()
        .map_err(|_| "BGMはすでに生成中です".to_string())?;
    if generation.is_none() {
        let client = CodexClient::start(
            resolve_codex_binary(),
            state.paths.generation_directory.clone(),
        )
        .map_err(error)?;
        *generation = Some(GenerationService::new(client));
    }
    let draft = generation
        .as_mut()
        .expect("generation service was initialized")
        .generate(
            GenerationControls {
                theme: request.theme,
                brightness: request.brightness,
                density: request.density,
                motion: request.motion,
            },
            focus_active,
        )
        .map_err(error)?;
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

#[tauri::command]
pub async fn preview_music_draft(
    draft_id: String,
    app: AppHandle,
) -> Result<GeneratedMusicDraft, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        preview_music_draft_blocking(draft_id, &state)
    })
    .await
    .map_err(error)?
}

fn preview_music_draft_blocking(
    draft_id: String,
    state: &AppState,
) -> Result<GeneratedMusicDraft, String> {
    let timer = state.timer.lock().map_err(error)?.state();
    if timer.status == TimerStatus::Running && timer.phase == TimerPhase::Focus {
        return Err("audio validation is deferred until focus ends".into());
    }
    let mut draft = state
        .drafts
        .lock()
        .map_err(error)?
        .get(&draft_id)
        .cloned()
        .ok_or_else(|| "music draft was not found".to_string())?;
    std::fs::create_dir_all(&state.paths.generation_directory).map_err(error)?;
    let source_path = state
        .paths
        .generation_directory
        .join(format!("{}.scd", draft.id));
    std::fs::write(&source_path, draft.supercollider_source.as_bytes()).map_err(error)?;

    let runtime_config = state.paths.runtime_config();
    StaticValidator::new()
        .validate_with_sclang(
            &runtime_config.sclang_path,
            &runtime_config.language_config,
            &state.paths.supercollider_directory.join("validate.scd"),
            &source_path,
        )
        .map_err(error)?;

    let mut runtime = state.runtime.lock().map_err(error)?;
    if runtime.is_none() {
        *runtime = Some(SuperColliderRuntime::start(runtime_config).map_err(error)?);
    }
    let runtime = runtime.as_mut().expect("runtime was initialized");
    runtime
        .validate_muted(
            &draft.id,
            source_path.to_string_lossy().as_ref(),
            draft.bpm as f32,
            draft.canonical_seed,
        )
        .map_err(error)?;
    draft.audio_validation = "passed".into();
    state
        .drafts
        .lock()
        .map_err(error)?
        .insert(draft.id.clone(), draft.clone());

    runtime.set_volume(0.8).map_err(error)?;
    runtime
        .load_track(
            &draft.id,
            source_path.to_string_lossy().as_ref(),
            draft.bpm as f32,
        )
        .map_err(error)?;
    runtime
        .play(&draft.id, draft.canonical_seed)
        .map_err(error)?;
    Ok(draft)
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
            Self::Start { now_ms } => (TimerAction::Start, now_ms),
            Self::Tick { now_ms } => (TimerAction::Tick, now_ms),
            Self::Pause { now_ms } => (TimerAction::Pause, now_ms),
            Self::Resume { now_ms } => (TimerAction::Resume, now_ms),
            Self::StartBreak { now_ms } => (TimerAction::StartBreak, now_ms),
            Self::End { now_ms } => (TimerAction::End, now_ms),
        }
    }
}

#[tauri::command]
pub fn timer_dispatch(
    event: TimerEventInput,
    preset_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<TimerState, String> {
    let (action, now_ms) = event.parts();
    let mut timer = state.timer.lock().map_err(error)?;
    if action == TimerAction::Start {
        if let Some(preset_id) = preset_id {
            let current = timer.state();
            if matches!(current.status, TimerStatus::Idle | TimerStatus::Completed) {
                let preset = find_preset(&state, &preset_id)?;
                *timer = TimerEngine::new(preset);
            }
        }
    }
    timer.dispatch(action, now_ms).map_err(error)
}

fn find_preset(state: &State<'_, AppState>, id: &str) -> Result<TimerPreset, String> {
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
    *state.music_disabled_session.lock().map_err(error)? = false;
    if let Some(runtime) = state.runtime.lock().map_err(error)?.as_mut() {
        runtime.coordinator.reset_for_new_focus_session();
    }
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

#[tauri::command]
pub async fn music_playback(
    action: String,
    track_id: Option<String>,
    seed: Option<i64>,
    app: AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        music_playback_blocking(action, track_id, seed, &state)
    })
    .await
    .map_err(error)?
}

fn music_playback_blocking(
    action: String,
    track_id: Option<String>,
    seed: Option<i64>,
    state: &AppState,
) -> Result<(), String> {
    if matches!(action.as_str(), "play" | "switch")
        && *state.music_disabled_session.lock().map_err(error)?
    {
        return Err(
            "BGM is disabled for this focus session after repeated runtime failures".into(),
        );
    }
    if matches!(action.as_str(), "stop" | "silence")
        && state.runtime.lock().map_err(error)?.is_none()
    {
        return Ok(());
    }
    let mut runtime = state.runtime.lock().map_err(error)?;
    if runtime.is_none() {
        *runtime = Some(SuperColliderRuntime::start(state.paths.runtime_config()).map_err(error)?);
    }
    let runtime = runtime.as_mut().expect("runtime was initialized");
    match action.as_str() {
        "play" | "switch" => {
            let track_id = track_id.ok_or_else(|| "trackId is required".to_string())?;
            let database = state.database.lock().map_err(error)?;
            let track = database
                .get_music_track(&track_id)
                .map_err(error)?
                .ok_or_else(|| "track was not found".to_string())?;
            TrackStore::new(&database, &state.paths.track_directory)
                .verify(&track)
                .map_err(error)?;
            runtime
                .load_track(&track.id, &track.source_path, track.bpm as f32)
                .map_err(error)?;
            let seed = seed.unwrap_or(track.canonical_seed);
            if action == "play" {
                runtime.play(&track.id, seed).map_err(error)?;
            } else {
                runtime.switch(&track.id, seed).map_err(error)?;
            }
        }
        "pause" => {
            runtime.pause().map_err(error)?;
        }
        "resume" => {
            runtime.resume().map_err(error)?;
        }
        "stop" | "silence" => {
            runtime.stop().map_err(error)?;
        }
        _ => return Err(format!("unknown playback action: {action}")),
    }
    Ok(())
}

fn validate_control(name: &str, value: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("invalid {name}: {value}"))
    }
}
