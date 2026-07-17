mod commands;
mod ipc;
pub mod music;

use commands::{AppState, NativePaths};
use lyra_core::{Database, TimerAction, TimerEngine, TimerPreset, TimerState, TimerStatus};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_notification::NotificationExt;

fn resolve_data_directory(
    default: std::path::PathBuf,
    e2e_override: Option<std::path::PathBuf>,
) -> std::path::PathBuf {
    e2e_override.unwrap_or(default)
}

#[derive(Debug, PartialEq, Eq)]
enum CloseWindowAction {
    HideAndKeepAudio,
    QuitAndStopAudio,
}

fn close_window_action(close_behavior: &str) -> CloseWindowAction {
    if close_behavior == "quit" {
        CloseWindowAction::QuitAndStopAudio
    } else {
        CloseWindowAction::HideAndKeepAudio
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(MacosLauncher::LaunchAgent)
                .build(),
        );
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    let app = builder
        .setup(|app| {
            let default_data_directory = app.path().app_data_dir()?;
            #[cfg(feature = "e2e")]
            let e2e_data_directory = std::env::var_os("LYRA_E2E_DATA_DIR").map(Into::into);
            #[cfg(not(feature = "e2e"))]
            let e2e_data_directory = None;
            let data_directory = resolve_data_directory(default_data_directory, e2e_data_directory);
            std::fs::create_dir_all(&data_directory)?;
            let paths = NativePaths::new(data_directory.clone());
            paths.cleanup_legacy_audio()?;
            let database = Database::open(data_directory.join("lyra.db"))?;
            database.recover_music_delete_quarantine(&data_directory)?;
            database.interrupt_running_sessions()?;
            let settings = database.get_app_settings()?;
            let presets = database.list_timer_presets()?;
            let startup_preset = select_startup_preset(&presets, &settings.default_preset_id)
                .ok_or("Standard timer preset was not seeded")?;
            app.manage(AppState {
                database: Mutex::new(database),
                timer: Mutex::new(TimerEngine::new(startup_preset)),
                generation: Mutex::new(None),
                generation_active: Arc::new(AtomicBool::new(false)),
                generation_cancellation: Arc::new(AtomicBool::new(false)),
                drafts: Mutex::new(HashMap::new()),
                paths,
            });
            ipc::setup(app);
            setup_tray(app)?;
            start_timer_loop(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_tasks,
            commands::add_task,
            commands::add_task_v2,
            commands::update_task,
            commands::reorder_tasks,
            commands::list_projects,
            commands::save_project,
            commands::list_tags,
            commands::save_tag,
            commands::set_task_completed,
            commands::move_task,
            commands::list_timer_presets,
            commands::save_timer_preset,
            commands::delete_timer_preset,
            commands::get_timer_state,
            commands::list_music_tracks,
            commands::rename_music_track,
            commands::delete_music_tracks,
            commands::get_app_settings,
            commands::save_app_settings,
            commands::runtime_diagnostics,
            commands::open_data_directory,
            commands::generate_music,
            commands::cancel_music_generation,
            commands::discard_music_draft,
            commands::confirm_music_draft_validation,
            commands::save_music_draft,
            commands::get_music_track_source,
            commands::save_variation,
            commands::rate_music_track,
            commands::start_focus,
            commands::finish_focus,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Lyra");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            let close_behavior = app_handle
                .try_state::<AppState>()
                .and_then(|state| state.database.lock().ok()?.get_app_settings().ok())
                .map(|settings| settings.close_behavior)
                .unwrap_or_else(|| "hide".into());
            match close_window_action(&close_behavior) {
                CloseWindowAction::QuitAndStopAudio => {
                    let _ = app_handle.emit_to("main", "audio://stop", ());
                    app_handle.exit(0);
                }
                CloseWindowAction::HideAndKeepAudio => {
                    api.prevent_close();
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }
        }
        RunEvent::ExitRequested { .. } => {
            let _ = app_handle.emit_to("main", "audio://stop", ());
            if let Some(state) = app_handle.try_state::<AppState>() {
                let _ = state
                    .database
                    .lock()
                    .expect("database lock poisoned")
                    .interrupt_running_sessions();
            }
        }
        _ => {}
    });
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    tauri::tray::TrayIconBuilder::with_id("lyra")
        .title("Lyra")
        .tooltip("Lyra 集中タイマー")
        .on_tray_icon_event(|tray, event| {
            if matches!(event, tauri::tray::TrayIconEvent::Click { .. }) {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn start_timer_loop(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut notified = false;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let state = app.state::<AppState>();
            let now_ms = unix_time_ms();
            let mut timer_state = {
                let timer = state.timer.lock().expect("timer lock poisoned");
                advance_timer(&timer, now_ms, false)
            };
            if timer_state.status == TimerStatus::AwaitingBreak && !notified {
                let (auto_start_break, notifications_enabled) = state
                    .database
                    .lock()
                    .ok()
                    .and_then(|database| database.get_app_settings().ok())
                    .map(|settings| (settings.auto_start_break, settings.notifications_enabled))
                    .unwrap_or((false, true));
                let _ = app.emit_to("main", "audio://stop", ());
                if notifications_enabled {
                    let body = if auto_start_break {
                        "BGMを停止し、休憩を始めました。"
                    } else {
                        "BGMを停止しました。休憩は準備ができたら開始してください。"
                    };
                    let _ = app
                        .notification()
                        .builder()
                        .title("集中が完了しました")
                        .body(body)
                        .show();
                }
                if auto_start_break {
                    let timer = state.timer.lock().expect("timer lock poisoned");
                    timer_state = advance_timer(&timer, now_ms, true);
                } else {
                    notified = true;
                }
            } else if timer_state.status != TimerStatus::AwaitingBreak {
                notified = false;
            }
            if let Some(tray) = app.tray_by_id("lyra") {
                let minutes = timer_state.remaining_seconds / 60;
                let seconds = timer_state.remaining_seconds % 60;
                let _ = tray.set_title(Some(format!("Lyra {minutes:02}:{seconds:02}")));
            }
            let _ = app.emit("timer://state", &timer_state);
        }
    });
}

fn advance_timer(timer: &TimerEngine, now_ms: u64, auto_start_break: bool) -> TimerState {
    let current = timer.state();
    let mut state = if current.status == TimerStatus::Running {
        timer
            .dispatch(TimerAction::Tick, now_ms)
            .unwrap_or_else(|_| timer.state())
    } else {
        current
    };
    if auto_start_break && state.status == TimerStatus::AwaitingBreak {
        state = timer
            .dispatch(TimerAction::StartBreak, now_ms)
            .unwrap_or(state);
    }
    state
}

fn select_startup_preset(presets: &[TimerPreset], desired_id: &str) -> Option<TimerPreset> {
    presets
        .iter()
        .find(|preset| preset.id == desired_id)
        .or_else(|| presets.iter().find(|preset| preset.id == "standard"))
        .cloned()
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod ipc_contract_tests {
    use crate::commands::{MusicGenerationProgress, TimerEventInput};
    use crate::ipc::{decode_timer_control, IpcResult};

    #[test]
    fn decodes_namespaced_timer_control_payloads() {
        let timer = decode_timer_control(
            r#"{"requestId":"timer-1","event":{"type":"start","nowMs":42},"presetId":"standard"}"#,
        )
        .unwrap();
        assert_eq!(timer.request_id, "timer-1");
        assert_eq!(timer.preset_id.as_deref(), Some("standard"));
        let preset = decode_timer_control(
            r#"{"requestId":"timer-2","event":{"type":"select_preset"},"presetId":"sprint"}"#,
        )
        .unwrap();
        assert!(matches!(preset.event, TimerEventInput::SelectPreset));
    }

    #[test]
    fn serializes_correlated_results_and_generation_progress() {
        let success = serde_json::to_value(IpcResult::success(
            "request-1",
            serde_json::json!({ "status": "stopped" }),
        ))
        .unwrap();
        assert_eq!(success["requestId"], "request-1");
        assert_eq!(success["ok"], true);
        let progress = serde_json::to_value(MusicGenerationProgress::new("validating")).unwrap();
        assert_eq!(progress["phase"], "validating");
    }
}

#[cfg(test)]
mod data_directory_tests {
    use super::{advance_timer, resolve_data_directory, select_startup_preset};
    use lyra_core::{TimerAction, TimerEngine, TimerPhase, TimerPreset, TimerStatus};
    use std::path::PathBuf;

    #[test]
    fn e2e_override_replaces_the_normal_application_data_directory() {
        let normal = PathBuf::from("/normal/app-data");
        let isolated = PathBuf::from("/tmp/lyra-e2e");

        assert_eq!(
            resolve_data_directory(normal, Some(isolated.clone())),
            isolated
        );
    }

    #[test]
    fn normal_application_data_directory_is_used_without_an_override() {
        let normal = PathBuf::from("/normal/app-data");

        assert_eq!(resolve_data_directory(normal.clone(), None), normal);
    }

    fn preset(id: &str, focus_minutes: i64) -> TimerPreset {
        TimerPreset {
            id: id.into(),
            name: id.into(),
            focus_minutes,
            short_break_minutes: 5,
            long_break_minutes: 15,
            cycles_before_long_break: 4,
            built_in: true,
        }
    }

    #[test]
    fn saved_default_preset_is_selected_with_standard_as_fallback() {
        let presets = vec![preset("standard", 25), preset("deep-focus", 50)];
        assert_eq!(
            select_startup_preset(&presets, "deep-focus").unwrap().id,
            "deep-focus"
        );
        assert_eq!(
            select_startup_preset(&presets, "missing").unwrap().id,
            "standard"
        );
    }

    #[test]
    fn automatic_break_starts_only_when_the_setting_is_enabled() {
        let manual = TimerEngine::new(preset("standard", 1));
        manual.dispatch(TimerAction::Start, 0).unwrap();
        assert_eq!(
            advance_timer(&manual, 60_000, false).status,
            TimerStatus::AwaitingBreak
        );

        let automatic = TimerEngine::new(preset("standard", 1));
        automatic.dispatch(TimerAction::Start, 0).unwrap();
        let state = advance_timer(&automatic, 60_000, true);
        assert_eq!(state.status, TimerStatus::Running);
        assert_eq!(state.phase, TimerPhase::ShortBreak);
        assert_eq!(state.remaining_seconds, 5 * 60);
    }
}

#[cfg(test)]
mod close_behavior_tests {
    use super::{close_window_action, CloseWindowAction};

    #[test]
    fn hiding_the_window_keeps_audio_playing() {
        assert_eq!(
            close_window_action("hide"),
            CloseWindowAction::HideAndKeepAudio
        );
    }

    #[test]
    fn quitting_the_application_stops_audio() {
        assert_eq!(
            close_window_action("quit"),
            CloseWindowAction::QuitAndStopAudio
        );
    }
}
