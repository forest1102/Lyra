mod commands;
pub mod music;

use commands::{AppState, NativePaths};
use lyra_core::{Database, TimerEngine};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_notification::NotificationExt;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_directory)?;
            let resource_directory = app.path().resource_dir()?.join("resources/supercollider");
            let database = Database::open(data_directory.join("lyra.db"))?;
            database.interrupt_running_sessions()?;
            let standard = database
                .list_timer_presets()?
                .into_iter()
                .find(|preset| preset.id == "standard")
                .ok_or("Standard timer preset was not seeded")?;
            let paths = NativePaths::new(data_directory, resource_directory);
            app.manage(AppState {
                database: Mutex::new(database),
                timer: Mutex::new(TimerEngine::new(standard)),
                generation: Mutex::new(None),
                drafts: Mutex::new(HashMap::new()),
                runtime: Mutex::new(None),
                music_disabled_session: Mutex::new(false),
                paths,
            });
            setup_tray(app)?;
            start_timer_loop(app.handle().clone());
            start_runtime_watchdog(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_tasks,
            commands::add_task,
            commands::set_task_completed,
            commands::move_task,
            commands::list_timer_presets,
            commands::save_timer_preset,
            commands::list_music_tracks,
            commands::generate_music,
            commands::preview_music_draft,
            commands::save_music_draft,
            commands::save_variation,
            commands::rate_music_track,
            commands::timer_dispatch,
            commands::start_focus,
            commands::finish_focus,
            commands::music_playback,
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
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        RunEvent::ExitRequested { .. } => {
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
                if let Ok(mut runtime) = state.runtime.lock() {
                    if let Some(runtime) = runtime.as_mut() {
                        let _ = runtime.stop();
                    }
                }
                notified = true;
            } else if timer_state.status != lyra_core::TimerStatus::AwaitingBreak {
                notified = false;
            }
        }
    });
}

fn start_runtime_watchdog(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let state = app.state::<AppState>();
        if *state
            .music_disabled_session
            .lock()
            .expect("music disabled lock poisoned")
        {
            continue;
        }
        let health = {
            let mut runtime = state.runtime.lock().expect("runtime lock poisoned");
            runtime
                .as_mut()
                .map(|runtime| runtime.health_check(unix_time_ms()))
        };
        let Some(crate::music::runtime::RuntimeHealth::RestartRequired(action)) = health else {
            continue;
        };
        match action {
            crate::music::runtime::RecoveryAction::DisableMusicForSession => {
                *state
                    .music_disabled_session
                    .lock()
                    .expect("music disabled lock poisoned") = true;
                *state.runtime.lock().expect("runtime lock poisoned") = None;
                let _ = app.emit(
                    "music://error",
                    "SuperCollider failed twice; BGM is disabled for this focus session",
                );
            }
            recovery => {
                let coordinator = {
                    let mut runtime = state.runtime.lock().expect("runtime lock poisoned");
                    runtime.as_mut().map(|runtime| runtime.take_coordinator())
                };
                let mut restarted = match crate::music::runtime::SuperColliderRuntime::start(
                    state.paths.runtime_config(),
                ) {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = app.emit("music://error", error.to_string());
                        continue;
                    }
                };
                if let Some(coordinator) = coordinator {
                    restarted.restore_coordinator(coordinator);
                }
                if let crate::music::runtime::RecoveryAction::RestartOnce { track_id, seed } =
                    recovery
                {
                    let track = state
                        .database
                        .lock()
                        .expect("database lock poisoned")
                        .get_music_track(&track_id)
                        .ok()
                        .flatten();
                    if let Some(track) = track {
                        let _ =
                            restarted.load_track(&track.id, &track.source_path, track.bpm as f32);
                        let _ = restarted.play(&track.id, seed);
                    }
                }
                *state.runtime.lock().expect("runtime lock poisoned") = Some(restarted);
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
