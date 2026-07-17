pub use crate::music::prompt::{GenerationControls, GenerationPrompt};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;

pub const TURN_TIMEOUT: Duration = Duration::from_secs(120);
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(250);
pub const MUSIC_GENERATION_MODEL: &str = "gpt-5.6-terra";

const GENERATION_INSTRUCTIONS: &str = "あなたはLyraのChucKコード生成器です。ユーザー入力に含まれる仕様とJSON Schemaだけに従い、ツールを使用せず、ファイルを読み書きせず、説明や途中経過を出さず、最終回答としてJSONだけを返してください。";

pub fn generation_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "schemaVersion", "title", "description", "bpm", "tailSeconds", "chuckSource"
        ],
        "properties": {
            "schemaVersion": { "type": "integer", "const": 1 },
            "title": { "type": "string", "minLength": 1, "maxLength": 60 },
            "description": { "type": "string", "minLength": 1, "maxLength": 240 },
            "bpm": { "type": "number", "minimum": 40, "maximum": 120 },
            "tailSeconds": { "type": "number", "minimum": 0, "maximum": 8 },
            "chuckSource": { "type": "string", "maxLength": 49152 }
        }
    })
}

pub struct JsonRpcBuilder;

impl JsonRpcBuilder {
    pub fn initialize(id: i64) -> Value {
        json!({
            "id": id,
            "method": "initialize",
            "params": {
                "clientInfo": { "name": "lyra", "title": "Lyra", "version": "0.1.0" }
            }
        })
    }

    pub fn thread_start(id: i64, cwd: impl AsRef<Path>) -> Value {
        json!({
            "id": id,
            "method": "thread/start",
            "params": {
                "model": MUSIC_GENERATION_MODEL,
                "cwd": cwd.as_ref(),
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "ephemeral": true,
                "developerInstructions": GENERATION_INSTRUCTIONS
            }
        })
    }

    pub fn turn_start(id: i64, thread_id: &str, cwd: &Path, prompt: &str) -> Value {
        json!({
            "id": id,
            "method": "turn/start",
            "params": {
                "threadId": thread_id,
                "cwd": cwd,
                "approvalPolicy": "never",
                "sandboxPolicy": { "type": "readOnly", "networkAccess": false },
                "effort": "low",
                "input": [{ "type": "text", "text": prompt }],
                "outputSchema": generation_output_schema()
            }
        })
    }
}

pub fn resolve_codex_binary() -> PathBuf {
    if let Some(path) = std::env::var_os("LYRA_CODEX_PATH") {
        return PathBuf::from(path);
    }
    if let Some(path) = executable_on_path("codex") {
        return path;
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for relative in [
            ".nix-profile/bin/codex",
            ".volta/bin/codex",
            ".bun/bin/codex",
            ".local/bin/codex",
        ] {
            let candidate = home.join(relative);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    for candidate in ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] {
        let candidate = PathBuf::from(candidate);
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from("codex")
}

fn executable_on_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|directory| directory.join(name))
            .find(|candidate| candidate.is_file())
    })
}

#[derive(Debug, Clone)]
pub struct GenerationTurn {
    pub thread_id: String,
    pub output: String,
}

#[derive(Debug, Error)]
pub enum CodexClientError {
    #[error("failed to start Codex App Server: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("Codex App Server stopped responding")]
    Disconnected,
    #[error("Codex request timed out")]
    Timeout,
    #[error("Codex request was cancelled")]
    Cancelled,
    #[error("Codex request failed: {0}")]
    Protocol(String),
    #[error("Codex turn completed without a JSON response")]
    MissingOutput,
}

pub struct CodexClient {
    process: Child,
    stdin: ChildStdin,
    receiver: Receiver<Value>,
    pending: VecDeque<Value>,
    next_id: i64,
    generation_cwd: PathBuf,
    cancellation: Arc<AtomicBool>,
}

impl CodexClient {
    pub fn start(
        codex_binary: impl AsRef<Path>,
        generation_cwd: PathBuf,
        cancellation: Arc<AtomicBool>,
    ) -> Result<Self, CodexClientError> {
        std::fs::create_dir_all(&generation_cwd)?;
        let mut process = Command::new(codex_binary.as_ref())
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| CodexClientError::Protocol("app-server stdin is unavailable".into()))?;
        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| CodexClientError::Protocol("app-server stdout is unavailable".into()))?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str(&line) {
                    if sender.send(value).is_err() {
                        break;
                    }
                }
            }
        });
        let mut client = Self {
            process,
            stdin,
            receiver,
            pending: VecDeque::new(),
            next_id: 1,
            generation_cwd,
            cancellation,
        };
        let id = client.take_id();
        client.request(JsonRpcBuilder::initialize(id), id, Duration::from_secs(10))?;
        client.write_json(&json!({ "method": "initialized", "params": {} }))?;
        Ok(client)
    }

    pub fn generate(
        &mut self,
        prompt: &GenerationPrompt,
    ) -> Result<GenerationTurn, CodexClientError> {
        let thread_request_id = self.take_id();
        let response = self.request(
            JsonRpcBuilder::thread_start(thread_request_id, &self.generation_cwd),
            thread_request_id,
            Duration::from_secs(10),
        )?;
        let thread_id = response
            .pointer("/result/thread/id")
            .and_then(Value::as_str)
            .ok_or_else(|| CodexClientError::Protocol("thread/start returned no thread id".into()))?
            .to_owned();
        let output = self.run_turn(&thread_id, &prompt.to_string())?;
        Ok(GenerationTurn { thread_id, output })
    }

    pub fn repair(
        &mut self,
        thread_id: &str,
        prompt: &GenerationPrompt,
        diagnostics: &str,
    ) -> Result<String, CodexClientError> {
        self.run_turn(thread_id, &prompt.repair(diagnostics))
    }

    fn run_turn(&mut self, thread_id: &str, prompt: &str) -> Result<String, CodexClientError> {
        let request_id = self.take_id();
        let request =
            JsonRpcBuilder::turn_start(request_id, thread_id, &self.generation_cwd, prompt);
        self.request(request, request_id, Duration::from_secs(10))?;
        let deadline = Instant::now() + TURN_TIMEOUT;
        let mut output = None;
        loop {
            if self.cancellation.load(Ordering::Acquire) {
                return Err(CodexClientError::Cancelled);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(CodexClientError::Timeout);
            }
            let message = match self.next_message(remaining.min(CANCELLATION_POLL_INTERVAL)) {
                Ok(message) => message,
                Err(CodexClientError::Timeout) => continue,
                Err(error) => return Err(error),
            };
            match message.get("method").and_then(Value::as_str) {
                Some("item/completed") => {
                    if message.pointer("/params/item/type").and_then(Value::as_str)
                        == Some("agentMessage")
                        && message
                            .pointer("/params/item/phase")
                            .and_then(Value::as_str)
                            != Some("commentary")
                    {
                        output = extract_agent_text(&message);
                    }
                }
                Some("turn/completed") => {
                    if let Some(error) = message
                        .pointer("/params/turn/error/message")
                        .and_then(Value::as_str)
                    {
                        return Err(CodexClientError::Protocol(error.into()));
                    }
                    return output.ok_or(CodexClientError::MissingOutput);
                }
                _ => {}
            }
        }
    }

    fn request(
        &mut self,
        request: Value,
        request_id: i64,
        timeout: Duration,
    ) -> Result<Value, CodexClientError> {
        self.write_json(&request)?;
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(CodexClientError::Timeout);
            }
            let message = self
                .receiver
                .recv_timeout(remaining)
                .map_err(|error| match error {
                    mpsc::RecvTimeoutError::Timeout => CodexClientError::Timeout,
                    mpsc::RecvTimeoutError::Disconnected => CodexClientError::Disconnected,
                })?;
            if message.get("id").and_then(Value::as_i64) == Some(request_id) {
                if let Some(error) = message.get("error") {
                    return Err(CodexClientError::Protocol(error.to_string()));
                }
                return Ok(message);
            }
            self.pending.push_back(message);
        }
    }

    fn next_message(&mut self, timeout: Duration) -> Result<Value, CodexClientError> {
        if let Some(message) = self.pending.pop_front() {
            return Ok(message);
        }
        self.receiver
            .recv_timeout(timeout)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => CodexClientError::Timeout,
                mpsc::RecvTimeoutError::Disconnected => CodexClientError::Disconnected,
            })
    }

    fn write_json(&mut self, value: &Value) -> Result<(), CodexClientError> {
        serde_json::to_writer(&mut self.stdin, value)
            .map_err(|error| CodexClientError::Protocol(error.to_string()))?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()?;
        Ok(())
    }

    fn take_id(&mut self) -> i64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
}

impl Drop for CodexClient {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}

fn extract_agent_text(message: &Value) -> Option<String> {
    if let Some(text) = message.pointer("/params/item/text").and_then(Value::as_str) {
        return Some(text.to_owned());
    }
    message
        .pointer("/params/item/content")
        .and_then(Value::as_array)
        .map(|content| {
            content
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|text| !text.is_empty())
}
