use crate::commands::{timer_dispatch_event, AppState, TimerEventInput};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Listener, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimerControlRequest {
    pub request_id: String,
    pub event: TimerEventInput,
    pub preset_id: Option<String>,
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
