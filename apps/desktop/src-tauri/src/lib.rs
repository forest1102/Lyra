mod commands;
mod ipc;
pub mod music;

use commands::{AppState, MusicPlaybackState, NativePaths};
use lyra_core::{Database, TimerEngine};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Copy)]
enum MusicLifecycle {
    HideWindow,
    ExitApplication,
}

trait MusicLifecycleRuntime {
    fn stop_music(&mut self);
}

impl MusicLifecycleRuntime for crate::music::runtime::SuperColliderRuntime {
    fn stop_music(&mut self) {
        let _ = self.stop();
    }
}

fn handle_music_lifecycle<R: MusicLifecycleRuntime>(
    runtime: &Mutex<Option<R>>,
    lifecycle: MusicLifecycle,
) {
    let mut runtime = runtime.lock().expect("runtime lock poisoned");
    match lifecycle {
        MusicLifecycle::HideWindow => {
            if let Some(runtime) = runtime.as_mut() {
                runtime.stop_music();
            }
        }
        MusicLifecycle::ExitApplication => {
            runtime.take();
        }
    }
}

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
                music_playback: Mutex::new(MusicPlaybackState::stopped()),
                music_control: ipc::MusicControlGate::new(),
                music_disabled_session: Mutex::new(false),
                paths,
            });
            ipc::setup(app);
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
            commands::get_timer_state,
            commands::list_music_tracks,
            commands::generate_music,
            commands::preview_music_draft,
            commands::save_music_draft,
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
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.music_control.hide();
                let ticket = state.music_control.ticket();
                let _ = state.music_control.run(ticket, "stop", || {
                    handle_music_lifecycle(&state.runtime, MusicLifecycle::HideWindow);
                    Ok(())
                });
                *state
                    .music_playback
                    .lock()
                    .expect("music playback lock poisoned") = MusicPlaybackState::stopped();
            }
            let _ = app_handle.emit("music://state", MusicPlaybackState::stopped());
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        RunEvent::ExitRequested { .. } => {
            if let Some(state) = app_handle.try_state::<AppState>() {
                handle_music_lifecycle(&state.runtime, MusicLifecycle::ExitApplication);
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
                if let Some(state) = tray.app_handle().try_state::<AppState>() {
                    state.music_control.show();
                }
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
                let stopped = MusicPlaybackState::stopped();
                if let Ok(mut playback) = state.music_playback.lock() {
                    *playback = stopped.clone();
                }
                let _ = app.emit("music://state", stopped);
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
                let stopped = MusicPlaybackState::stopped();
                *state
                    .music_playback
                    .lock()
                    .expect("music playback lock poisoned") = stopped.clone();
                let _ = app.emit("music://state", stopped);
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
                        let restart_result = restarted
                            .load_track(&track.id, &track.source_path, track.bpm as f32)
                            .and_then(|_| restarted.play(&track.id, seed));
                        if let Err(error) = restart_result {
                            let stopped = MusicPlaybackState::stopped();
                            *state
                                .music_playback
                                .lock()
                                .expect("music playback lock poisoned") = stopped.clone();
                            let _ = app.emit("music://state", stopped);
                            let _ = app.emit("music://error", error.to_string());
                        } else {
                            let playing = MusicPlaybackState {
                                status: "playing".into(),
                                track_id: Some(track.id),
                            };
                            *state
                                .music_playback
                                .lock()
                                .expect("music playback lock poisoned") = playing.clone();
                            let _ = app.emit("music://state", playing);
                        }
                    } else {
                        let stopped = MusicPlaybackState::stopped();
                        *state
                            .music_playback
                            .lock()
                            .expect("music playback lock poisoned") = stopped.clone();
                        let _ = app.emit("music://state", stopped);
                        let _ = app.emit("music://error", "BGM track was not found during restart");
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

#[cfg(test)]
mod music_lifecycle_tests {
    use super::{handle_music_lifecycle, MusicLifecycle, MusicLifecycleRuntime};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    struct FakeRuntime {
        stopped: Arc<AtomicBool>,
        dropped: Arc<AtomicBool>,
    }

    impl MusicLifecycleRuntime for FakeRuntime {
        fn stop_music(&mut self) {
            self.stopped.store(true, Ordering::SeqCst);
        }
    }

    impl Drop for FakeRuntime {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn hiding_the_window_stops_music_but_keeps_the_runtime() {
        let stopped = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let runtime = Mutex::new(Some(FakeRuntime {
            stopped: Arc::clone(&stopped),
            dropped: Arc::clone(&dropped),
        }));

        handle_music_lifecycle(&runtime, MusicLifecycle::HideWindow);

        assert!(stopped.load(Ordering::SeqCst));
        assert!(!dropped.load(Ordering::SeqCst));
        assert!(runtime.lock().unwrap().is_some());
    }

    #[test]
    fn exiting_the_application_drops_the_runtime_immediately() {
        let stopped = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));
        let runtime = Mutex::new(Some(FakeRuntime {
            stopped,
            dropped: Arc::clone(&dropped),
        }));

        handle_music_lifecycle(&runtime, MusicLifecycle::ExitApplication);

        assert!(dropped.load(Ordering::SeqCst));
        assert!(runtime.lock().unwrap().is_none());
    }
}

#[cfg(test)]
mod ipc_contract_tests {
    use crate::commands::{MusicGenerationProgress, TimerEventInput};
    use crate::ipc::{decode_music_control, decode_timer_control, IpcResult};

    #[test]
    fn decodes_namespaced_control_event_payloads() {
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

        let music = decode_music_control(
            r#"{"requestId":"music-1","action":"play","trackId":"track-1","seed":7}"#,
        )
        .unwrap();
        assert_eq!(music.request_id, "music-1");
        assert_eq!(music.action, "play");
        assert_eq!(music.track_id.as_deref(), Some("track-1"));
    }

    #[test]
    fn serializes_correlated_success_and_failure_results() {
        let success = serde_json::to_value(IpcResult::success(
            "request-1",
            serde_json::json!({ "status": "stopped" }),
        ))
        .unwrap();
        assert_eq!(success["requestId"], "request-1");
        assert_eq!(success["ok"], true);
        assert_eq!(success["data"]["status"], "stopped");

        let failure = serde_json::to_value(IpcResult::failure("request-2", "rejected")).unwrap();
        assert_eq!(failure["requestId"], "request-2");
        assert_eq!(failure["ok"], false);
        assert_eq!(failure["error"], "rejected");
    }

    #[test]
    fn serializes_music_generation_channel_progress() {
        let progress = serde_json::to_value(MusicGenerationProgress::new("validating")).unwrap();
        assert_eq!(progress["phase"], "validating");
    }
}
