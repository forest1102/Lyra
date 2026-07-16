use crate::music::codex_client::{resolve_codex_binary, CodexClient, GenerationControls};
use crate::music::generation::{GeneratedMusicDraft, GenerationService};
use crate::music::track_store::TrackStore;
use lyra_core::{
    AddTask, AddTaskV2, AppSettingsV1, Database, DeleteMusicTracksResult, FocusSession,
    MusicRecipeV1, MusicTrackListQuery, MusicTrackRecord, Project, RuntimeDiagnostic, Tag, Task,
    TaskList, TaskStatus, TimerAction, TimerEngine, TimerPhase, TimerPreset, TimerState,
    TimerStatus, UpdateTask,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_opener::OpenerExt;

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
    use super::{
        delete_timer_preset_coordinated, focus_is_active_for_generation, read_timer_state,
        timer_dispatch_event, wait_for_generation_to_stop, AppState, NativePaths, TimerEventInput,
    };
    use lyra_core::{Database, TimerAction, TimerEngine, TimerPhase, TimerPreset, TimerStatus};
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

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

    #[test]
    fn repeated_start_with_the_selected_preset_preserves_cycles_until_long_break() {
        let directory = tempfile::tempdir().unwrap();
        let standard = TimerPreset {
            id: "standard".into(),
            name: "Standard".into(),
            focus_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            cycles_before_long_break: 4,
            built_in: true,
        };
        let state = AppState {
            database: Mutex::new(Database::open_in_memory().unwrap()),
            timer: Mutex::new(TimerEngine::new(standard)),
            generation: Mutex::new(None),
            generation_active: Arc::new(AtomicBool::new(false)),
            generation_cancellation: Arc::new(AtomicBool::new(false)),
            drafts: Mutex::new(HashMap::new()),
            paths: NativePaths::new(directory.path().to_path_buf()),
        };
        let mut now = 0;
        for expected_cycle in 1..=4 {
            timer_dispatch_event(
                TimerEventInput::Start { now_ms: now },
                Some("standard".into()),
                &state,
            )
            .unwrap();
            now += 25 * 60 * 1_000;
            let awaiting = timer_dispatch_event(
                TimerEventInput::Tick { now_ms: now },
                Some("standard".into()),
                &state,
            )
            .unwrap();
            assert_eq!(awaiting.completed_focus_cycles, expected_cycle);
            let resting = timer_dispatch_event(
                TimerEventInput::StartBreak { now_ms: now },
                Some("standard".into()),
                &state,
            )
            .unwrap();
            assert_eq!(resting.phase == TimerPhase::LongBreak, expected_cycle == 4);
            now += resting.remaining_seconds * 1_000;
            timer_dispatch_event(
                TimerEventInput::Tick { now_ms: now },
                Some("standard".into()),
                &state,
            )
            .unwrap();
        }
    }

    #[test]
    fn edited_selected_preset_is_loaded_on_the_next_start() {
        let directory = tempfile::tempdir().unwrap();
        let original = TimerPreset {
            id: "custom".into(),
            name: "Custom".into(),
            focus_minutes: 30,
            short_break_minutes: 5,
            long_break_minutes: 15,
            cycles_before_long_break: 4,
            built_in: false,
        };
        let database = Database::open_in_memory().unwrap();
        database.save_timer_preset(original.clone()).unwrap();
        let state = AppState {
            database: Mutex::new(database),
            timer: Mutex::new(TimerEngine::new(original.clone())),
            generation: Mutex::new(None),
            generation_active: Arc::new(AtomicBool::new(false)),
            generation_cancellation: Arc::new(AtomicBool::new(false)),
            drafts: Mutex::new(HashMap::new()),
            paths: NativePaths::new(directory.path().to_path_buf()),
        };
        let edited = TimerPreset {
            focus_minutes: 40,
            name: "Custom 40".into(),
            ..original
        };
        state
            .database
            .lock()
            .unwrap()
            .save_timer_preset(edited.clone())
            .unwrap();

        let running = timer_dispatch_event(
            TimerEventInput::Start { now_ms: 1_000 },
            Some(edited.id.clone()),
            &state,
        )
        .unwrap();

        assert_eq!(running.preset, edited);
        assert_eq!(running.remaining_seconds, 40 * 60);
    }

    #[test]
    fn selected_timer_preset_cannot_be_deleted() {
        let directory = tempfile::tempdir().unwrap();
        let selected = TimerPreset {
            id: "custom".into(),
            name: "Custom".into(),
            focus_minutes: 30,
            short_break_minutes: 5,
            long_break_minutes: 15,
            cycles_before_long_break: 4,
            built_in: false,
        };
        let database = Database::open_in_memory().unwrap();
        database.save_timer_preset(selected.clone()).unwrap();
        let state = AppState {
            database: Mutex::new(database),
            timer: Mutex::new(TimerEngine::new(selected)),
            generation: Mutex::new(None),
            generation_active: Arc::new(AtomicBool::new(false)),
            generation_cancellation: Arc::new(AtomicBool::new(false)),
            drafts: Mutex::new(HashMap::new()),
            paths: NativePaths::new(directory.path().to_path_buf()),
        };

        assert!(delete_timer_preset_coordinated("custom", &state).is_err());
        assert!(state
            .database
            .lock()
            .unwrap()
            .list_timer_presets()
            .unwrap()
            .iter()
            .any(|preset| preset.id == "custom"));
    }

    #[test]
    fn paused_focus_still_defers_music_validation() {
        let timer = TimerEngine::new(TimerPreset {
            id: "standard".into(),
            name: "Standard".into(),
            focus_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            cycles_before_long_break: 4,
            built_in: true,
        });
        timer.dispatch(TimerAction::Start, 1_000).unwrap();
        let paused = timer.dispatch(TimerAction::Pause, 2_000).unwrap();

        assert!(focus_is_active_for_generation(&paused));
    }

    #[test]
    fn cancellation_acknowledgement_waits_until_generation_is_inactive() {
        let generation_active = Arc::new(AtomicBool::new(true));
        let worker_flag = generation_active.clone();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(5));
            worker_flag.store(false, std::sync::atomic::Ordering::Release);
        });

        wait_for_generation_to_stop(&generation_active, 100, std::time::Duration::from_millis(1))
            .unwrap();

        worker.join().unwrap();
        assert!(!generation_active.load(std::sync::atomic::Ordering::Acquire));
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
pub fn add_task_v2(input: AddTaskV2, state: State<'_, AppState>) -> Result<Task, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .add_task_v2(input)
        .map_err(error)
}

#[tauri::command]
pub fn update_task(
    id: String,
    input: UpdateTask,
    state: State<'_, AppState>,
) -> Result<Task, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .update_task(&id, input)
        .map_err(error)
}

#[tauri::command]
pub fn reorder_tasks(
    ids: Vec<String>,
    status: TaskStatus,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .database
        .lock()
        .map_err(error)?
        .reorder_tasks(&ids, status)
        .map_err(error)
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .list_projects()
        .map_err(error)
}

#[tauri::command]
pub fn save_project(project: Project, state: State<'_, AppState>) -> Result<Project, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .save_project(project)
        .map_err(error)
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .list_tags()
        .map_err(error)
}

#[tauri::command]
pub fn save_tag(tag: Tag, state: State<'_, AppState>) -> Result<Tag, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .save_tag(tag)
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
pub fn delete_timer_preset(id: String, state: State<'_, AppState>) -> Result<(), String> {
    delete_timer_preset_coordinated(&id, &state)
}

fn delete_timer_preset_coordinated(id: &str, state: &AppState) -> Result<(), String> {
    if state.timer.lock().map_err(error)?.state().preset.id == id {
        return Err("active timer preset cannot be deleted".into());
    }
    state
        .database
        .lock()
        .map_err(error)?
        .delete_timer_preset(id)
        .map_err(error)
}

#[tauri::command]
pub fn list_music_tracks(
    query: Option<MusicTrackListQuery>,
    state: State<'_, AppState>,
) -> Result<Vec<MusicTrackRecord>, String> {
    let database = state.database.lock().map_err(error)?;
    match query {
        Some(query) => database.list_music_tracks_filtered(&query).map_err(error),
        None => database.list_music_tracks().map_err(error),
    }
}

#[tauri::command]
pub fn rename_music_track(
    id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<MusicTrackRecord, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .rename_music_track(&id, &title)
        .map_err(error)
}

#[tauri::command]
pub fn delete_music_tracks(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<DeleteMusicTracksResult, String> {
    let database = state.database.lock().map_err(error)?;
    database
        .delete_music_tracks(&ids, &state.paths.data_directory)
        .map_err(error)
}

#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettingsV1, String> {
    state
        .database
        .lock()
        .map_err(error)?
        .get_app_settings()
        .map_err(error)
}

#[tauri::command]
pub fn save_app_settings(settings: AppSettingsV1, app: AppHandle) -> Result<AppSettingsV1, String> {
    let state = app.state::<AppState>();
    let database = state.database.lock().map_err(error)?;
    let current = database.get_app_settings().map_err(error)?;
    let autostart = app.autolaunch();
    save_app_settings_coordinated(
        &settings,
        current.launch_at_login,
        || database.validate_app_settings(&settings).map_err(error),
        |enabled| {
            if enabled {
                autostart
                    .enable()
                    .map_err(|error| format!("ログイン時起動を有効にできませんでした: {error}"))
            } else {
                autostart
                    .disable()
                    .map_err(|error| format!("ログイン時起動を無効にできませんでした: {error}"))
            }
        },
        || database.save_app_settings(&settings).map_err(error),
    )
}

fn save_app_settings_coordinated<V, A, P>(
    settings: &AppSettingsV1,
    previous_launch_at_login: bool,
    validate: V,
    mut apply_autostart: A,
    persist: P,
) -> Result<AppSettingsV1, String>
where
    V: FnOnce() -> Result<(), String>,
    A: FnMut(bool) -> Result<(), String>,
    P: FnOnce() -> Result<AppSettingsV1, String>,
{
    validate()?;
    let autostart_changed = settings.launch_at_login != previous_launch_at_login;
    if autostart_changed {
        apply_autostart(settings.launch_at_login)?;
    }
    match persist() {
        Ok(saved) => Ok(saved),
        Err(persist_error) if autostart_changed => {
            match apply_autostart(previous_launch_at_login) {
                Ok(()) => Err(persist_error),
                Err(rollback_error) => Err(format!(
                    "{persist_error}; ログイン時起動の復元にも失敗しました: {rollback_error}"
                )),
            }
        }
        Err(persist_error) => Err(persist_error),
    }
}

#[tauri::command]
pub fn runtime_diagnostics(state: State<'_, AppState>) -> Result<Vec<RuntimeDiagnostic>, String> {
    let database = state.database.lock().map_err(error)?;
    let mut diagnostics = vec![database.sqlite_diagnostic()];
    let codex = resolve_codex_binary();
    diagnostics.push(RuntimeDiagnostic {
        component: "codex".into(),
        status: if codex.is_file() { "ok" } else { "error" }.into(),
        message: if codex.is_file() {
            format!("Codex found at {}", codex.display())
        } else {
            "Codex executable was not found".into()
        },
        remediation: (!codex.is_file())
            .then(|| "Codex CLIをインストールしPATHを確認してください".into()),
    });
    Ok(diagnostics)
}

#[tauri::command]
pub fn open_data_directory(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    app.opener()
        .open_path(
            state.paths.data_directory.to_string_lossy().into_owned(),
            None::<&str>,
        )
        .map_err(|error| format!("データフォルダを開けませんでした: {error}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateMusicRequest {
    recipe: Option<MusicRecipeV1>,
    theme: Option<String>,
    arrangement: Option<String>,
    brightness: Option<String>,
    density: Option<String>,
    motion: Option<String>,
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
pub async fn cancel_music_generation(state: State<'_, AppState>) -> Result<(), String> {
    state.generation_cancellation.store(true, Ordering::Release);
    let generation_active = state.generation_active.clone();
    tauri::async_runtime::spawn_blocking(move || {
        wait_for_generation_to_stop(
            &generation_active,
            400,
            std::time::Duration::from_millis(25),
        )
    })
    .await
    .map_err(error)?
}

fn wait_for_generation_to_stop(
    generation_active: &AtomicBool,
    attempts: usize,
    interval: std::time::Duration,
) -> Result<(), String> {
    for _ in 0..attempts {
        if !generation_active.load(Ordering::Acquire) {
            return Ok(());
        }
        std::thread::sleep(interval);
    }
    Err("music generation cancellation timed out".into())
}

#[tauri::command]
pub fn discard_music_draft(draft_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.drafts.lock().map_err(error)?.remove(&draft_id);
    Ok(())
}

fn generate_music_blocking(
    request: GenerateMusicRequest,
    state: &AppState,
) -> Result<GeneratedMusicDraft, String> {
    let legacy_controls = if request.recipe.is_none() {
        let theme = request
            .theme
            .ok_or_else(|| "theme is required for legacy generation".to_string())?;
        let arrangement = request
            .arrangement
            .ok_or_else(|| "arrangement is required for legacy generation".to_string())?;
        let brightness = request
            .brightness
            .ok_or_else(|| "brightness is required for legacy generation".to_string())?;
        let density = request
            .density
            .ok_or_else(|| "density is required for legacy generation".to_string())?;
        let motion = request
            .motion
            .ok_or_else(|| "motion is required for legacy generation".to_string())?;
        validate_control(
            "theme",
            &theme,
            &[
                "deep-space",
                "rainy-cabin",
                "minimal-pulse",
                "organic-drift",
            ],
        )?;
        validate_control("brightness", &brightness, &["low", "medium", "high"])?;
        validate_music_arrangement(&arrangement)?;
        validate_control("density", &density, &["low", "medium", "high"])?;
        validate_control("motion", &motion, &["low", "medium", "high"])?;
        Some(GenerationControls {
            theme,
            arrangement,
            brightness,
            density,
            motion,
        })
    } else {
        None
    };
    let focus_active = focus_is_active_for_generation(&state.timer.lock().map_err(error)?.state());
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
    let service = generation
        .as_mut()
        .expect("generation service was initialized");
    let generated = match request.recipe {
        Some(recipe) => service.generate_recipe(recipe, focus_active),
        None => service.generate(
            legacy_controls.expect("legacy controls validated"),
            focus_active,
        ),
    };
    let draft = match generated {
        Ok(draft) => draft,
        Err(generation_error) => {
            *generation = None;
            return Err(error(generation_error));
        }
    };
    if state.generation_cancellation.load(Ordering::Acquire) {
        return Err("music generation was cancelled".into());
    }
    let mut drafts = state.drafts.lock().map_err(error)?;
    replace_generated_draft(&mut drafts, draft.clone());
    Ok(draft)
}

fn focus_is_active_for_generation(timer: &TimerState) -> bool {
    matches!(timer.status, TimerStatus::Running | TimerStatus::Paused)
        && timer.phase == TimerPhase::Focus
}

fn replace_generated_draft(
    drafts: &mut HashMap<String, GeneratedMusicDraft>,
    draft: GeneratedMusicDraft,
) {
    drafts.clear();
    drafts.insert(draft.id.clone(), draft);
}

#[tauri::command]
pub fn save_music_draft(
    draft_id: String,
    state: State<'_, AppState>,
) -> Result<MusicTrackRecord, String> {
    let mut drafts = state.drafts.lock().map_err(error)?;
    let database = state.database.lock().map_err(error)?;
    save_music_draft_from_map(&mut drafts, &draft_id, |draft| {
        TrackStore::new(&database, &state.paths.track_directory)
            .save_draft(draft)
            .map_err(error)
    })
}

fn save_music_draft_from_map<F>(
    drafts: &mut HashMap<String, GeneratedMusicDraft>,
    draft_id: &str,
    save: F,
) -> Result<MusicTrackRecord, String>
where
    F: FnOnce(GeneratedMusicDraft) -> Result<MusicTrackRecord, String>,
{
    let draft = drafts
        .get(draft_id)
        .cloned()
        .ok_or_else(|| "music draft was not found".to_string())?;
    if draft.audio_validation != "passed" {
        return Err("audio validation must pass before saving".into());
    }
    let saved = save(draft)?;
    drafts.remove(draft_id);
    Ok(saved)
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
                if current.preset != preset {
                    *timer = TimerEngine::new(preset);
                }
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
    use super::{
        replace_generated_draft, save_app_settings_coordinated, save_music_draft_from_map,
        validate_audio_report, validate_music_arrangement, AppSettingsV1, DraftValidationReport,
        GeneratedMusicDraft,
    };
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;

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

    #[test]
    fn invalid_settings_do_not_change_autostart_or_persist() {
        let settings = AppSettingsV1 {
            launch_at_login: true,
            ..AppSettingsV1::default()
        };
        let autostart_calls = Cell::new(0);
        let persist_calls = Cell::new(0);
        let result = save_app_settings_coordinated(
            &settings,
            false,
            || Err("invalid settings".into()),
            |_| {
                autostart_calls.set(autostart_calls.get() + 1);
                Ok(())
            },
            || {
                persist_calls.set(persist_calls.get() + 1);
                Ok(settings.clone())
            },
        );

        assert!(result.is_err());
        assert_eq!(autostart_calls.get(), 0);
        assert_eq!(persist_calls.get(), 0);
    }

    #[test]
    fn database_failure_rolls_autostart_back_to_the_previous_value() {
        let settings = AppSettingsV1 {
            launch_at_login: true,
            ..AppSettingsV1::default()
        };
        let applied = RefCell::new(Vec::new());
        let result = save_app_settings_coordinated(
            &settings,
            false,
            || Ok(()),
            |enabled| {
                applied.borrow_mut().push(enabled);
                Ok(())
            },
            || Err("injected database failure".into()),
        );

        assert!(result.is_err());
        assert_eq!(*applied.borrow(), vec![true, false]);
    }

    #[test]
    fn failed_draft_save_keeps_the_draft_available_for_retry() {
        let draft = GeneratedMusicDraft {
            id: "draft-1".into(),
            parent_track_id: None,
            title: "Draft".into(),
            description: "test".into(),
            theme: "deep-space".into(),
            arrangement: "ambient".into(),
            brightness: "medium".into(),
            density: "medium".into(),
            motion: "low".into(),
            bpm: 64.0,
            tail_seconds: 4.0,
            chuck_source: "SinOsc s => dac;".into(),
            source_sha256: "hash".into(),
            canonical_seed: 1,
            audio_validation: "passed".into(),
            recipe_version: Some(1),
            recipe_json: Some(r#"{"version":1,"moods":[]}"#.into()),
            structure_family: "ambient".into(),
        };
        let mut drafts = HashMap::from([(draft.id.clone(), draft)]);

        let result = save_music_draft_from_map(&mut drafts, "draft-1", |_| {
            Err("injected database failure".into())
        });

        assert!(result.is_err());
        assert!(drafts.contains_key("draft-1"));
    }

    #[test]
    fn a_new_generated_draft_replaces_the_unreachable_previous_draft() {
        let draft = |id: &str| GeneratedMusicDraft {
            id: id.into(),
            parent_track_id: None,
            title: "Draft".into(),
            description: "test".into(),
            theme: "deep-space".into(),
            arrangement: "ambient".into(),
            brightness: "medium".into(),
            density: "medium".into(),
            motion: "low".into(),
            bpm: 64.0,
            tail_seconds: 4.0,
            chuck_source: "SinOsc s => dac;".into(),
            source_sha256: "hash".into(),
            canonical_seed: 1,
            audio_validation: "pending".into(),
            recipe_version: Some(1),
            recipe_json: Some(r#"{"version":1,"moods":[]}"#.into()),
            structure_family: "ambient".into(),
        };
        let mut drafts = HashMap::from([("old".into(), draft("old"))]);

        replace_generated_draft(&mut drafts, draft("new"));

        assert_eq!(drafts.len(), 1);
        assert!(drafts.contains_key("new"));
    }
}
