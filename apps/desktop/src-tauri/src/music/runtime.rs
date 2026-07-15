#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaybackSelection {
    pub request_id: i64,
    pub track_id: String,
    pub seed: i64,
    pub deck: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwitchDecision {
    Accepted { standby_deck: usize },
    IgnoredStale,
    MusicDisabled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecoveryAction {
    RestartOnce { track_id: String, seed: i64 },
    DisableMusicForSession,
    RestartIdleRuntime,
}

pub struct PlaybackCoordinator {
    active: Option<PlaybackSelection>,
    pending: Option<PlaybackSelection>,
    last_request_id: i64,
    first_failure_ms: Option<u64>,
    music_disabled: bool,
}

#[derive(Debug, Clone)]
pub struct MusicRuntimeConfig {
    pub sclang_path: PathBuf,
    pub scsynth_path: PathBuf,
    pub language_config: PathBuf,
    pub bootstrap_script: PathBuf,
    pub plugin_path: PathBuf,
    pub xdg_config_home: PathBuf,
    pub xdg_data_home: PathBuf,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeEvent {
    Ready,
    Acknowledged {
        request_id: i64,
        command: String,
    },
    Loaded {
        request_id: i64,
        track_id: String,
    },
    State {
        request_id: i64,
        state: String,
    },
    Metrics {
        average_cpu: f32,
        peak_cpu: f32,
        synths: i32,
        groups: i32,
    },
    Error {
        request_id: i64,
        code: String,
        message: String,
    },
    Unknown(OscMessage),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeHealth {
    Healthy,
    WaitingForNextPing { failures: u8 },
    RestartRequired(RecoveryAction),
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioValidationMetrics {
    pub average_cpu: f32,
    pub peak_cpu: f32,
    pub maximum_synths: i32,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("failed to start SuperCollider runtime: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("SuperCollider did not become ready: {0}")]
    Startup(String),
    #[error("runtime OSC packet is invalid: {0}")]
    InvalidPacket(String),
    #[error("runtime response timed out")]
    Timeout,
    #[error("runtime rejected request {request_id}: {code}: {message}")]
    Rejected {
        request_id: i64,
        code: String,
        message: String,
    },
    #[error("audio validation exceeded runtime limits: {0}")]
    Overloaded(String),
    #[error("SuperCollider {operation} failed: {message}")]
    Operation {
        operation: &'static str,
        message: String,
    },
}

pub struct SuperColliderRuntime {
    config: MusicRuntimeConfig,
    process: Child,
    process_group_id: u32,
    socket: UdpSocket,
    language_address: SocketAddr,
    token: String,
    next_request_id: i64,
    consecutive_ping_failures: u8,
    diagnostics: Arc<Mutex<VecDeque<String>>>,
    pub coordinator: PlaybackCoordinator,
}

impl SuperColliderRuntime {
    pub fn start(config: MusicRuntimeConfig) -> Result<Self, RuntimeError> {
        std::fs::create_dir_all(&config.xdg_config_home)?;
        std::fs::create_dir_all(&config.xdg_data_home)?;
        let socket = UdpSocket::bind("127.0.0.1:0")?;
        socket.set_read_timeout(Some(Duration::from_secs(2)))?;
        let rust_port = socket.local_addr()?.port();
        let language_port = reserve_loopback_port()?;
        let token = Uuid::new_v4().simple().to_string();

        let mut command = Command::new(&config.sclang_path);
        command
            .arg("-D")
            .arg("-l")
            .arg(&config.language_config)
            .arg(&config.bootstrap_script)
            .env("LYRA_OSC_TOKEN", &token)
            .env("LYRA_RUST_PORT", rust_port.to_string())
            .env("LYRA_SC_PORT", language_port.to_string())
            .env("LYRA_PLUGIN_PATH", &config.plugin_path)
            .env("LYRA_SCSYNTH_PATH", &config.scsynth_path)
            .env("XDG_CONFIG_HOME", &config.xdg_config_home)
            .env("XDG_DATA_HOME", &config.xdg_data_home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut process = spawn_process_group(&mut command)?;
        let process_group_id = process.id();

        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| RuntimeError::Startup("sclang stdout is unavailable".into()))?;
        let stderr = process
            .stderr
            .take()
            .ok_or_else(|| RuntimeError::Startup("sclang stderr is unavailable".into()))?;
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        let diagnostics = Arc::new(Mutex::new(VecDeque::with_capacity(100)));
        let stdout_diagnostics = Arc::clone(&diagnostics);
        std::thread::spawn(move || {
            let mut ready_sent = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                push_diagnostic(&stdout_diagnostics, line.clone());
                if !ready_sent && line.starts_with("LYRA_READY:") {
                    let _ = ready_sender.send(Ok(()));
                    ready_sent = true;
                }
            }
            if !ready_sent {
                let _ = ready_sender.send(Err(diagnostic_text(&stdout_diagnostics)));
            }
        });
        let stderr_diagnostics = Arc::clone(&diagnostics);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                push_diagnostic(&stderr_diagnostics, line);
            }
        });
        match ready_receiver.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => {}
            Ok(Err(diagnostics)) => {
                terminate_process_group(&mut process, process_group_id);
                return Err(RuntimeError::Startup(diagnostics));
            }
            Err(_) => {
                terminate_process_group(&mut process, process_group_id);
                return Err(RuntimeError::Startup("10 second startup timeout".into()));
            }
        }

        Ok(Self {
            config,
            process,
            process_group_id,
            socket,
            language_address: SocketAddr::from(([127, 0, 0, 1], language_port)),
            token,
            next_request_id: 1,
            consecutive_ping_failures: 0,
            diagnostics,
            coordinator: PlaybackCoordinator::new(),
        })
    }

    pub fn config(&self) -> &MusicRuntimeConfig {
        &self.config
    }

    pub fn take_coordinator(&mut self) -> PlaybackCoordinator {
        std::mem::take(&mut self.coordinator)
    }

    pub fn restore_coordinator(&mut self, coordinator: PlaybackCoordinator) {
        self.coordinator = coordinator;
    }

    pub fn load_track(
        &mut self,
        track_id: &str,
        source_path: &str,
        bpm: f32,
    ) -> Result<i64, RuntimeError> {
        let request_id = self.send(
            "/lyra/v1/load",
            vec![
                OscArgument::String(track_id.into()),
                OscArgument::String(source_path.into()),
                OscArgument::Float(bpm),
            ],
        )?;
        self.wait_for(request_id, |event| {
            matches!(event, RuntimeEvent::Loaded { .. })
        })?;
        Ok(request_id)
    }

    pub fn play(&mut self, track_id: &str, seed: i64) -> Result<i64, RuntimeError> {
        self.switch_with_address("/lyra/v1/play", track_id, seed)
    }

    pub fn switch(&mut self, track_id: &str, seed: i64) -> Result<i64, RuntimeError> {
        self.switch_with_address("/lyra/v1/switch", track_id, seed)
    }

    fn switch_with_address(
        &mut self,
        address: &str,
        track_id: &str,
        seed: i64,
    ) -> Result<i64, RuntimeError> {
        let request_id = self.send(
            address,
            vec![
                OscArgument::String(track_id.into()),
                OscArgument::Int(normalize_osc_integer(seed)),
            ],
        )?;
        let decision = self
            .coordinator
            .request_switch(request_id, track_id.into(), seed);
        if matches!(decision, SwitchDecision::MusicDisabled) {
            return Err(RuntimeError::Startup(
                "music is disabled for this focus session".into(),
            ));
        }
        Ok(request_id)
    }

    pub fn pause(&mut self) -> Result<i64, RuntimeError> {
        self.send_and_ack("/lyra/v1/pause", Vec::new())
    }

    pub fn resume(&mut self) -> Result<i64, RuntimeError> {
        self.send_and_ack("/lyra/v1/resume", Vec::new())
    }

    pub fn stop(&mut self) -> Result<i64, RuntimeError> {
        self.coordinator.clear_playback();
        self.send_and_ack("/lyra/v1/stop", Vec::new())
    }

    pub fn set_volume(&mut self, volume: f32) -> Result<i64, RuntimeError> {
        self.send_and_ack(
            "/lyra/v1/volume",
            vec![OscArgument::Float(volume.clamp(0.0, 1.0))],
        )
    }

    pub fn validate_muted(
        &mut self,
        track_id: &str,
        source_path: &str,
        bpm: f32,
        seed: i64,
    ) -> Result<AudioValidationMetrics, RuntimeError> {
        self.set_volume(0.0)
            .map_err(|error| operation_error("volume", error))?;
        self.load_track(track_id, source_path, bpm)
            .map_err(|error| operation_error("load", error))?;
        let request_id = self
            .play(track_id, seed)
            .map_err(|error| operation_error("play", error))?;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut average_samples = Vec::new();
        let mut peak_cpu = 0.0_f32;
        let mut maximum_synths = 0_i32;
        while std::time::Instant::now() < deadline {
            match self.receive() {
                Ok(RuntimeEvent::State {
                    request_id: event_id,
                    ..
                }) if event_id == request_id => {
                    self.coordinator.confirm_switch(request_id);
                }
                Ok(RuntimeEvent::Metrics {
                    average_cpu,
                    peak_cpu: peak,
                    synths,
                    ..
                }) => {
                    average_samples.push(average_cpu);
                    peak_cpu = peak_cpu.max(peak);
                    maximum_synths = maximum_synths.max(synths);
                }
                Ok(RuntimeEvent::Error {
                    request_id,
                    code,
                    message,
                }) => {
                    let _ = self.stop();
                    return Err(RuntimeError::Rejected {
                        request_id,
                        code,
                        message: format!("{message}\n{}", diagnostic_text(&self.diagnostics)),
                    });
                }
                Ok(_) | Err(RuntimeError::Timeout) => {}
                Err(error) => return Err(error),
            }
        }
        self.stop()
            .map_err(|error| operation_error("stop", error))?;
        let average_cpu = if average_samples.is_empty() {
            0.0
        } else {
            average_samples.iter().sum::<f32>() / average_samples.len() as f32
        };
        let metrics = AudioValidationMetrics {
            average_cpu,
            peak_cpu,
            maximum_synths,
        };
        if average_cpu >= 70.0 {
            return Err(RuntimeError::Overloaded(format!(
                "average CPU was {average_cpu:.1}%"
            )));
        }
        if peak_cpu >= 90.0 {
            return Err(RuntimeError::Overloaded(format!(
                "peak CPU was {peak_cpu:.1}%"
            )));
        }
        if maximum_synths >= 512 {
            return Err(RuntimeError::Overloaded(format!(
                "validation created {maximum_synths} synth nodes"
            )));
        }
        Ok(metrics)
    }

    pub fn health_check(&mut self, now_ms: u64) -> RuntimeHealth {
        let ping = self.send_and_ack("/lyra/v1/ping", Vec::new());
        if ping.is_ok() {
            self.consecutive_ping_failures = 0;
            return RuntimeHealth::Healthy;
        }
        self.consecutive_ping_failures += 1;
        if self.consecutive_ping_failures < 3 {
            RuntimeHealth::WaitingForNextPing {
                failures: self.consecutive_ping_failures,
            }
        } else {
            self.consecutive_ping_failures = 0;
            RuntimeHealth::RestartRequired(self.coordinator.register_runtime_failure(now_ms))
        }
    }

    pub fn receive(&mut self) -> Result<RuntimeEvent, RuntimeError> {
        let mut packet = [0_u8; 65_536];
        let size = self
            .socket
            .recv(&mut packet)
            .map_err(|error| match error.kind() {
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => {
                    RuntimeError::Timeout
                }
                _ => RuntimeError::Spawn(error),
            })?;
        let message = decode_message(&packet[..size])
            .map_err(|error| RuntimeError::InvalidPacket(error.to_string()))?;
        if message.arguments.first() != Some(&OscArgument::String(self.token.clone())) {
            return Err(RuntimeError::InvalidPacket(
                "authentication token mismatch".into(),
            ));
        }
        parse_event(message)
    }

    fn send_and_ack(
        &mut self,
        address: &str,
        arguments: Vec<OscArgument>,
    ) -> Result<i64, RuntimeError> {
        let request_id = self.send(address, arguments)?;
        self.wait_for(request_id, |event| {
            matches!(event, RuntimeEvent::Acknowledged { .. })
        })?;
        Ok(request_id)
    }

    fn send(
        &mut self,
        address: &str,
        mut arguments: Vec<OscArgument>,
    ) -> Result<i64, RuntimeError> {
        let request_id = self.next_request_id;
        self.next_request_id += 1;
        let mut authenticated = vec![
            OscArgument::String(self.token.clone()),
            OscArgument::Int(normalize_osc_integer(request_id)),
        ];
        authenticated.append(&mut arguments);
        let packet = encode_message(&OscMessage {
            address: address.into(),
            arguments: authenticated,
        });
        self.socket.send_to(&packet, self.language_address)?;
        Ok(request_id)
    }

    fn wait_for(
        &mut self,
        request_id: i64,
        predicate: impl Fn(&RuntimeEvent) -> bool,
    ) -> Result<RuntimeEvent, RuntimeError> {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        loop {
            if std::time::Instant::now() >= deadline {
                return Err(RuntimeError::Timeout);
            }
            let event = self.receive()?;
            match &event {
                RuntimeEvent::Error {
                    request_id: event_id,
                    code,
                    message,
                } if *event_id == request_id => {
                    return Err(RuntimeError::Rejected {
                        request_id,
                        code: code.clone(),
                        message: format!("{message}\n{}", diagnostic_text(&self.diagnostics)),
                    });
                }
                RuntimeEvent::State {
                    request_id: event_id,
                    ..
                } => {
                    self.coordinator.confirm_switch(*event_id);
                }
                _ => {}
            }
            if event_request_id(&event) == Some(request_id) && predicate(&event) {
                return Ok(event);
            }
        }
    }
}

impl Drop for SuperColliderRuntime {
    fn drop(&mut self) {
        let _ = self.send_and_ack("/lyra/v1/shutdown", Vec::new());
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            match self.process.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(_) => break,
            }
        }
        terminate_process_group(&mut self.process, self.process_group_id);
    }
}

#[cfg(unix)]
fn spawn_process_group(command: &mut Command) -> Result<Child, std::io::Error> {
    use std::os::unix::process::CommandExt;

    command.process_group(0).spawn()
}

#[cfg(not(unix))]
fn spawn_process_group(command: &mut Command) -> Result<Child, std::io::Error> {
    command.spawn()
}

#[cfg(unix)]
fn process_group_exists(process_group_id: u32) -> bool {
    let Ok(process_group_id) = i32::try_from(process_group_id) else {
        return false;
    };
    let result = unsafe { libc::kill(-process_group_id, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(unix)]
fn terminate_process_group(process: &mut Child, process_group_id: u32) {
    if let Ok(process_group_id) = i32::try_from(process_group_id) {
        unsafe {
            libc::kill(-process_group_id, libc::SIGTERM);
        }
        let deadline = std::time::Instant::now() + Duration::from_millis(500);
        while process_group_exists(process_group_id as u32) && std::time::Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        if process_group_exists(process_group_id as u32) {
            unsafe {
                libc::kill(-process_group_id, libc::SIGKILL);
            }
        }
    }
    let _ = process.kill();
    let _ = process.wait();
}

#[cfg(not(unix))]
fn terminate_process_group(process: &mut Child, _process_group_id: u32) {
    let _ = process.kill();
    let _ = process.wait();
}

fn reserve_loopback_port() -> Result<u16, std::io::Error> {
    let socket = UdpSocket::bind("127.0.0.1:0")?;
    Ok(socket.local_addr()?.port())
}

fn normalize_osc_integer(value: i64) -> i32 {
    value.rem_euclid(i64::from(i32::MAX)) as i32
}

fn push_diagnostic(diagnostics: &Mutex<VecDeque<String>>, line: String) {
    let Ok(mut diagnostics) = diagnostics.lock() else {
        return;
    };
    if diagnostics.len() == 100 {
        diagnostics.pop_front();
    }
    diagnostics.push_back(line);
}

fn operation_error(operation: &'static str, error: RuntimeError) -> RuntimeError {
    RuntimeError::Operation {
        operation,
        message: error.to_string(),
    }
}

fn diagnostic_text(diagnostics: &Mutex<VecDeque<String>>) -> String {
    diagnostics
        .lock()
        .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_else(|_| "SuperColliderの診断ログを取得できませんでした".into())
}

fn parse_event(message: OscMessage) -> Result<RuntimeEvent, RuntimeError> {
    let request_id = || match message.arguments.get(1) {
        Some(OscArgument::Int64(value)) => Ok(*value),
        Some(OscArgument::Int(value)) => Ok(i64::from(*value)),
        _ => Err(RuntimeError::InvalidPacket("missing request id".into())),
    };
    let string_at = |index| match message.arguments.get(index) {
        Some(OscArgument::String(value)) => Ok(value.clone()),
        _ => Err(RuntimeError::InvalidPacket(format!(
            "missing string argument {index}"
        ))),
    };
    match message.address.as_str() {
        "/lyra/v1/ready" => Ok(RuntimeEvent::Ready),
        "/lyra/v1/ack" => Ok(RuntimeEvent::Acknowledged {
            request_id: request_id()?,
            command: string_at(2)?,
        }),
        "/lyra/v1/loaded" => Ok(RuntimeEvent::Loaded {
            request_id: request_id()?,
            track_id: string_at(2)?,
        }),
        "/lyra/v1/state" => Ok(RuntimeEvent::State {
            request_id: request_id()?,
            state: string_at(2)?,
        }),
        "/lyra/v1/error" => Ok(RuntimeEvent::Error {
            request_id: request_id()?,
            code: string_at(2)?,
            message: string_at(3)?,
        }),
        "/lyra/v1/metrics" => match &message.arguments[1..] {
            [OscArgument::Float(average_cpu), OscArgument::Float(peak_cpu), OscArgument::Int(synths), OscArgument::Int(groups), ..] => {
                Ok(RuntimeEvent::Metrics {
                    average_cpu: *average_cpu,
                    peak_cpu: *peak_cpu,
                    synths: *synths,
                    groups: *groups,
                })
            }
            _ => Err(RuntimeError::InvalidPacket(
                "invalid metrics payload".into(),
            )),
        },
        _ => Ok(RuntimeEvent::Unknown(message)),
    }
}

fn event_request_id(event: &RuntimeEvent) -> Option<i64> {
    match event {
        RuntimeEvent::Acknowledged { request_id, .. }
        | RuntimeEvent::Loaded { request_id, .. }
        | RuntimeEvent::State { request_id, .. }
        | RuntimeEvent::Error { request_id, .. } => Some(*request_id),
        _ => None,
    }
}

impl Default for PlaybackCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl PlaybackCoordinator {
    pub fn new() -> Self {
        Self {
            active: None,
            pending: None,
            last_request_id: -1,
            first_failure_ms: None,
            music_disabled: false,
        }
    }

    pub fn request_switch(
        &mut self,
        request_id: i64,
        track_id: String,
        seed: i64,
    ) -> SwitchDecision {
        if self.music_disabled {
            return SwitchDecision::MusicDisabled;
        }
        if request_id <= self.last_request_id {
            return SwitchDecision::IgnoredStale;
        }
        self.last_request_id = request_id;
        let standby_deck = self
            .active
            .as_ref()
            .map_or(0, |selection| 1 - selection.deck);
        self.pending = Some(PlaybackSelection {
            request_id,
            track_id,
            seed,
            deck: standby_deck,
        });
        SwitchDecision::Accepted { standby_deck }
    }

    pub fn confirm_switch(&mut self, request_id: i64) -> bool {
        if request_id != self.last_request_id {
            return false;
        }
        let Some(pending) = self.pending.take() else {
            return false;
        };
        if pending.request_id != request_id {
            return false;
        }
        self.active = Some(pending);
        true
    }

    pub fn active(&self) -> Option<&PlaybackSelection> {
        self.active.as_ref()
    }

    pub fn clear_playback(&mut self) {
        self.active = None;
        self.pending = None;
    }

    pub fn music_disabled(&self) -> bool {
        self.music_disabled
    }

    pub fn register_runtime_failure(&mut self, now_ms: u64) -> RecoveryAction {
        let repeated_within_five_minutes = self
            .first_failure_ms
            .is_some_and(|first| now_ms.saturating_sub(first) <= 5 * 60 * 1_000);
        if repeated_within_five_minutes {
            self.music_disabled = true;
            self.pending = None;
            return RecoveryAction::DisableMusicForSession;
        }
        self.first_failure_ms = Some(now_ms);
        match &self.active {
            Some(selection) => RecoveryAction::RestartOnce {
                track_id: selection.track_id.clone(),
                seed: selection.seed,
            },
            None => RecoveryAction::RestartIdleRuntime,
        }
    }

    pub fn reset_for_new_focus_session(&mut self) {
        self.first_failure_ms = None;
        self.music_disabled = false;
        self.pending = None;
    }
}
use crate::music::osc_protocol::{decode_message, encode_message, OscArgument, OscMessage};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use thiserror::Error;
use uuid::Uuid;

#[cfg(all(test, unix))]
mod process_group_tests {
    use super::{process_group_exists, spawn_process_group, terminate_process_group};
    use std::process::Command;
    use std::time::{Duration, Instant};

    #[test]
    fn terminating_the_runtime_process_group_reaps_descendants() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 30 & wait"]);
        let mut process = spawn_process_group(&mut command).unwrap();
        let process_group_id = process.id();

        assert!(process_group_exists(process_group_id));
        terminate_process_group(&mut process, process_group_id);

        let deadline = Instant::now() + Duration::from_secs(2);
        while process_group_exists(process_group_id) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!process_group_exists(process_group_id));
    }
}
