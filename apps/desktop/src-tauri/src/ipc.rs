use crate::commands::{music_playback_event, timer_dispatch_event, AppState, TimerEventInput};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use tauri::{Emitter, Listener, Manager};

pub(crate) struct MusicControlGate {
    serial: Mutex<()>,
    window_visible: AtomicBool,
    generation: AtomicU64,
    sequence: AtomicU64,
}

#[derive(Clone, Copy)]
pub(crate) struct MusicControlTicket {
    generation: u64,
    sequence: u64,
}

impl MusicControlGate {
    pub(crate) fn new() -> Self {
        Self {
            serial: Mutex::new(()),
            window_visible: AtomicBool::new(true),
            generation: AtomicU64::new(0),
            sequence: AtomicU64::new(0),
        }
    }

    pub(crate) fn ticket(&self) -> MusicControlTicket {
        MusicControlTicket {
            generation: self.generation.load(Ordering::Acquire),
            sequence: self.sequence.fetch_add(1, Ordering::AcqRel) + 1,
        }
    }

    pub(crate) fn run<T>(
        &self,
        ticket: MusicControlTicket,
        action: &str,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<Option<T>, String> {
        let _serial = self.serial.lock().map_err(|error| error.to_string())?;
        if ticket.generation != self.generation.load(Ordering::Acquire)
            || ticket.sequence != self.sequence.load(Ordering::Acquire)
        {
            return Ok(None);
        }
        if matches!(action, "play" | "switch") && !self.window_visible.load(Ordering::Acquire) {
            return Err("music playback is disabled while the window is hidden".into());
        }
        operation().map(Some)
    }

    pub(crate) fn hide(&self) {
        self.window_visible.store(false, Ordering::Release);
        self.generation.fetch_add(1, Ordering::AcqRel);
    }

    pub(crate) fn show(&self) {
        self.window_visible.store(true, Ordering::Release);
        self.generation.fetch_add(1, Ordering::AcqRel);
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimerControlRequest {
    pub request_id: String,
    pub event: TimerEventInput,
    pub preset_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MusicControlRequest {
    pub request_id: String,
    pub action: String,
    pub track_id: Option<String>,
    pub seed: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IpcResult {
    request_id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl IpcResult {
    pub(crate) fn success(request_id: impl Into<String>, data: serde_json::Value) -> Self {
        Self {
            request_id: request_id.into(),
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub(crate) fn failure(request_id: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            request_id: request_id.into(),
            ok: false,
            data: None,
            error: Some(error.into()),
        }
    }
}

pub(crate) fn decode_timer_control(payload: &str) -> Result<TimerControlRequest, String> {
    serde_json::from_str(payload).map_err(|error| error.to_string())
}

pub(crate) fn decode_music_control(payload: &str) -> Result<MusicControlRequest, String> {
    serde_json::from_str(payload).map_err(|error| error.to_string())
}

pub(crate) fn setup(app: &tauri::App) {
    let timer_app = app.handle().clone();
    app.listen("timer://control", move |event| {
        let app = timer_app.clone();
        let payload = event.payload().to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let request = match decode_timer_control(&payload) {
                Ok(request) => request,
                Err(error) => {
                    emit_decode_failure(&app, &payload, error);
                    return;
                }
            };
            let request_id = request.request_id.clone();
            let state = app.state::<AppState>();
            match timer_dispatch_event(request.event, request.preset_id, &state) {
                Ok(timer_state) => {
                    let _ = app.emit_to("main", "timer://state", &timer_state);
                    emit_result(
                        &app,
                        IpcResult::success(
                            request_id,
                            serde_json::to_value(timer_state).unwrap_or(serde_json::Value::Null),
                        ),
                    );
                }
                Err(error) => emit_result(&app, IpcResult::failure(request_id, error)),
            }
        });
    });

    let music_app = app.handle().clone();
    app.listen("music://control", move |event| {
        let ticket = music_app.state::<AppState>().music_control.ticket();
        let app = music_app.clone();
        let payload = event.payload().to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let request = match decode_music_control(&payload) {
                Ok(request) => request,
                Err(error) => {
                    emit_decode_failure(&app, &payload, error);
                    return;
                }
            };
            let request_id = request.request_id.clone();
            let state = app.state::<AppState>();
            let action = request.action;
            let playback_action = action.clone();
            match state.music_control.run(ticket, &action, || {
                music_playback_event(playback_action, request.track_id, request.seed, &state)
            }) {
                Ok(Some(music_state)) => {
                    let _ = app.emit_to("main", "music://state", music_state);
                    emit_result(
                        &app,
                        IpcResult::success(request_id, serde_json::Value::Null),
                    );
                }
                Ok(None) => emit_result(
                    &app,
                    IpcResult::success(request_id, serde_json::Value::Null),
                ),
                Err(error) => emit_result(&app, IpcResult::failure(request_id, error)),
            }
        });
    });
}

fn emit_decode_failure(app: &tauri::AppHandle, payload: &str, error: String) {
    if let Some(request_id) = request_id(payload) {
        emit_result(app, IpcResult::failure(request_id, error));
    }
}

fn emit_result(app: &tauri::AppHandle, result: IpcResult) {
    let _ = app.emit_to("main", "ipc://result", result);
}

fn request_id(payload: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()?
        .get("requestId")?
        .as_str()
        .map(str::to_owned)
}

#[cfg(test)]
mod music_control_gate_tests {
    use super::MusicControlGate;
    use std::cell::Cell;

    #[test]
    fn hidden_window_rejects_playback_until_it_is_shown_again() {
        let gate = MusicControlGate::new();
        let stale_ticket = gate.ticket();

        gate.hide();
        assert!(gate.run(stale_ticket, "play", || Ok(())).unwrap().is_none());
        assert!(gate.run(stale_ticket, "stop", || Ok(())).unwrap().is_none());
        assert!(gate.run(gate.ticket(), "play", || Ok(())).is_err());

        gate.show();
        assert!(gate.run(stale_ticket, "play", || Ok(())).unwrap().is_none());
        assert!(gate
            .run(gate.ticket(), "play", || Ok(()))
            .unwrap()
            .is_some());
    }

    #[test]
    fn only_the_latest_queued_music_operation_executes() {
        let gate = MusicControlGate::new();
        let older = gate.ticket();
        let latest = gate.ticket();
        let older_called = Cell::new(false);

        let older_result = gate.run(older, "play", || {
            older_called.set(true);
            Ok(())
        });
        let latest_result = gate.run(latest, "stop", || Ok(()));

        assert!(!older_called.get());
        assert!(older_result.unwrap().is_none());
        assert!(latest_result.unwrap().is_some());
    }
}
