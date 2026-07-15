mod commands;
mod ipc;
pub mod music;

use commands::{AppState, NativePaths};
use lyra_core::{Database, TimerEngine};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_notification::NotificationExt;

fn resolve_data_directory(
    default: std::path::PathBuf,
    e2e_override: Option<std::path::PathBuf>,
) -> std::path::PathBuf {
    e2e_override.unwrap_or(default)
}

pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());
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
            database.interrupt_running_sessions()?;
            let standard = database
                .list_timer_presets()?
                .into_iter()
                .find(|preset| preset.id == "standard")
                .ok_or("Standard timer preset was not seeded")?;
            app.manage(AppState {
                database: Mutex::new(database),
                timer: Mutex::new(TimerEngine::new(standard)),
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
            commands::set_task_completed,
            commands::move_task,
            commands::list_timer_presets,
            commands::save_timer_preset,
            commands::get_timer_state,
            commands::list_music_tracks,
            commands::generate_music,
            commands::cancel_music_generation,
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
            api.prevent_close();
            let _ = app_handle.emit_to("main", "audio://stop", ());
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
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
            let timer_state = {
                let timer = state.timer.lock().expect("timer lock poisoned");
                if timer.state().status == lyra_core::TimerStatus::Running {
                    timer
                        .dispatch(lyra_core::TimerAction::Tick, unix_time_ms())
                        .unwrap_or_else(|_| timer.state())
                } else {
                    timer.state()
                }
            };
            if let Some(tray) = app.tray_by_id("lyra") {
                let minutes = timer_state.remaining_seconds / 60;
                let seconds = timer_state.remaining_seconds % 60;
                let _ = tray.set_title(Some(format!("Lyra {minutes:02}:{seconds:02}")));
            }
            let _ = app.emit("timer://state", &timer_state);
            if timer_state.status == lyra_core::TimerStatus::AwaitingBreak && !notified {
                let _ = app
                    .notification()
                    .builder()
                    .title("集中が完了しました")
                    .body("BGMを停止しました。休憩は準備ができたら開始してください。")
                    .show();
                let _ = app.emit_to("main", "audio://stop", ());
                notified = true;
            } else if timer_state.status != lyra_core::TimerStatus::AwaitingBreak {
                notified = false;
            }
        }
    });
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
    use super::resolve_data_directory;
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
}
