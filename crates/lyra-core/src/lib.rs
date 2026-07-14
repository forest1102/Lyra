use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum LyraError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

pub type Result<T> = std::result::Result<T, LyraError>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskList {
    Today,
    Backlog,
}

impl TaskList {
    fn as_str(self) -> &'static str {
        match self {
            Self::Today => "today",
            Self::Backlog => "backlog",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "today" => Ok(Self::Today),
            "backlog" => Ok(Self::Backlog),
            other => Err(LyraError::InvalidInput(format!(
                "unknown task list: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub list: TaskList,
    pub completed: bool,
    pub estimated_pomodoros: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTask {
    pub title: String,
    pub list: TaskList,
    pub estimated_pomodoros: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimerPreset {
    pub id: String,
    pub name: String,
    pub focus_minutes: i64,
    pub short_break_minutes: i64,
    pub long_break_minutes: i64,
    pub cycles_before_long_break: i64,
    pub built_in: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimerPhase {
    Focus,
    ShortBreak,
    LongBreak,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimerStatus {
    Idle,
    Running,
    Paused,
    AwaitingBreak,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    pub preset: TimerPreset,
    pub phase: TimerPhase,
    pub status: TimerStatus,
    pub remaining_seconds: u64,
    pub completed_focus_cycles: u32,
    pub deadline_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimerAction {
    Start,
    Tick,
    Pause,
    Resume,
    StartBreak,
    End,
}

pub struct TimerEngine {
    state: Mutex<TimerState>,
    subscribers: Mutex<Vec<mpsc::Sender<TimerState>>>,
}

impl TimerEngine {
    pub fn new(preset: TimerPreset) -> Self {
        Self {
            state: Mutex::new(TimerState {
                remaining_seconds: (preset.focus_minutes * 60) as u64,
                preset,
                phase: TimerPhase::Focus,
                status: TimerStatus::Idle,
                completed_focus_cycles: 0,
                deadline_ms: None,
            }),
            subscribers: Mutex::new(Vec::new()),
        }
    }

    pub fn state(&self) -> TimerState {
        self.state
            .lock()
            .expect("timer state lock poisoned")
            .clone()
    }

    pub fn subscribe(&self) -> mpsc::Receiver<TimerState> {
        let (sender, receiver) = mpsc::channel();
        self.subscribers
            .lock()
            .expect("timer subscriber lock poisoned")
            .push(sender);
        receiver
    }

    pub fn dispatch(&self, action: TimerAction, now_ms: u64) -> Result<TimerState> {
        let next = {
            let state = self.state.lock().expect("timer state lock poisoned");
            reduce_timer(&state, action, now_ms)
        };
        *self.state.lock().expect("timer state lock poisoned") = next.clone();
        self.subscribers
            .lock()
            .expect("timer subscriber lock poisoned")
            .retain(|subscriber| subscriber.send(next.clone()).is_ok());
        Ok(next)
    }
}

fn reduce_timer(state: &TimerState, action: TimerAction, now_ms: u64) -> TimerState {
    let mut next = state.clone();
    match action {
        TimerAction::Start
            if state.phase == TimerPhase::Focus
                && matches!(state.status, TimerStatus::Idle | TimerStatus::Completed) =>
        {
            next.status = TimerStatus::Running;
            next.deadline_ms = Some(now_ms + state.remaining_seconds * 1_000);
        }
        TimerAction::Pause if state.status == TimerStatus::Running => {
            if let Some(deadline) = state.deadline_ms {
                next.remaining_seconds = deadline.saturating_sub(now_ms).div_ceil(1_000);
            }
            next.status = TimerStatus::Paused;
            next.deadline_ms = None;
        }
        TimerAction::Resume if state.status == TimerStatus::Paused => {
            next.status = TimerStatus::Running;
            next.deadline_ms = Some(now_ms + state.remaining_seconds * 1_000);
        }
        TimerAction::Tick if state.status == TimerStatus::Running => {
            let remaining = state
                .deadline_ms
                .map(|deadline| deadline.saturating_sub(now_ms).div_ceil(1_000))
                .unwrap_or(state.remaining_seconds);
            next.remaining_seconds = remaining;
            if remaining == 0 {
                next.deadline_ms = None;
                if state.phase == TimerPhase::Focus {
                    next.status = TimerStatus::AwaitingBreak;
                    next.completed_focus_cycles += 1;
                } else {
                    next.status = TimerStatus::Completed;
                    next.phase = TimerPhase::Focus;
                    next.remaining_seconds = (state.preset.focus_minutes * 60) as u64;
                }
            }
        }
        TimerAction::StartBreak if state.status == TimerStatus::AwaitingBreak => {
            let long_break =
                state.completed_focus_cycles % state.preset.cycles_before_long_break as u32 == 0;
            next.phase = if long_break {
                TimerPhase::LongBreak
            } else {
                TimerPhase::ShortBreak
            };
            next.remaining_seconds = if long_break {
                state.preset.long_break_minutes as u64 * 60
            } else {
                state.preset.short_break_minutes as u64 * 60
            };
            next.status = TimerStatus::Running;
            next.deadline_ms = Some(now_ms + next.remaining_seconds * 1_000);
        }
        TimerAction::End => {
            next.status = TimerStatus::Completed;
            next.deadline_ms = None;
        }
        _ => {}
    }
    next
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FocusSessionStatus {
    Running,
    Completed,
    Interrupted,
}

impl FocusSessionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Interrupted => "interrupted",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "running" => Ok(Self::Running),
            "completed" => Ok(Self::Completed),
            "interrupted" => Ok(Self::Interrupted),
            other => Err(LyraError::InvalidInput(format!(
                "unknown session status: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub preset_id: String,
    pub music_track_id: Option<String>,
    pub status: FocusSessionStatus,
    pub elapsed_seconds: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrackRecord {
    pub id: String,
    pub parent_track_id: Option<String>,
    pub title: String,
    pub description: String,
    pub theme: String,
    pub brightness: String,
    pub density: String,
    pub motion: String,
    pub bpm: i64,
    pub tail_seconds: i64,
    pub source_path: String,
    pub source_sha256: String,
    pub canonical_seed: i64,
    pub rating: Option<String>,
    pub favorite: bool,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewMusicTrack {
    pub parent_track_id: Option<String>,
    pub title: String,
    pub description: String,
    pub theme: String,
    pub brightness: String,
    pub density: String,
    pub motion: String,
    pub bpm: i64,
    pub tail_seconds: i64,
    pub source: String,
    pub canonical_seed: i64,
    pub directory: PathBuf,
}

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        let database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    pub fn open_in_memory() -> Result<Self> {
        let connection = Connection::open_in_memory()?;
        let database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    fn migrate(&self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
              list TEXT NOT NULL CHECK(list IN ('today', 'backlog')),
              completed INTEGER NOT NULL DEFAULT 0,
              estimated_pomodoros INTEGER CHECK(estimated_pomodoros BETWEEN 1 AND 99),
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS focus_sessions (
              id TEXT PRIMARY KEY,
              preset_id TEXT NOT NULL,
              music_track_id TEXT,
              status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'interrupted')),
              elapsed_seconds INTEGER NOT NULL DEFAULT 0,
              started_at TEXT NOT NULL,
              ended_at TEXT
            );
            CREATE TABLE IF NOT EXISTS focus_session_tasks (
              session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
              task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
              completed_at_end INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(session_id, task_id)
            );
            CREATE TABLE IF NOT EXISTS music_tracks (
              id TEXT PRIMARY KEY,
              parent_track_id TEXT REFERENCES music_tracks(id),
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              theme TEXT NOT NULL,
              brightness TEXT NOT NULL,
              density TEXT NOT NULL,
              motion TEXT NOT NULL,
              bpm INTEGER NOT NULL CHECK(bpm BETWEEN 40 AND 120),
              tail_seconds INTEGER NOT NULL CHECK(tail_seconds BETWEEN 0 AND 8),
              source_path TEXT NOT NULL UNIQUE,
              source_sha256 TEXT NOT NULL,
              canonical_seed INTEGER NOT NULL,
              rating TEXT CHECK(rating IN ('good', 'poor')),
              favorite INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS timer_presets (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              focus_minutes INTEGER NOT NULL,
              short_break_minutes INTEGER NOT NULL,
              long_break_minutes INTEGER NOT NULL,
              cycles_before_long_break INTEGER NOT NULL,
              built_in INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
              VALUES(1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            INSERT OR IGNORE INTO timer_presets VALUES
              ('sprint', 'Sprint', 15, 3, 10, 4, 1),
              ('standard', 'Standard', 25, 5, 15, 4, 1),
              ('deep-focus', 'Deep Focus', 50, 10, 20, 3, 1);
            "#,
        )?;
        Ok(())
    }

    pub fn add_task(&self, input: AddTask) -> Result<Task> {
        let title = input.title.trim();
        if title.is_empty() || title.chars().count() > 200 {
            return Err(LyraError::InvalidInput(
                "task title must contain 1 to 200 characters".into(),
            ));
        }
        if input
            .estimated_pomodoros
            .is_some_and(|estimate| !(1..=99).contains(&estimate))
        {
            return Err(LyraError::InvalidInput(
                "estimated pomodoros must be between 1 and 99".into(),
            ));
        }
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        self.connection.execute(
            "INSERT INTO tasks(id, title, list, completed, estimated_pomodoros, created_at, updated_at) VALUES(?1, ?2, ?3, 0, ?4, ?5, ?5)",
            params![id, title, input.list.as_str(), input.estimated_pomodoros, now],
        )?;
        self.get_task(&id)?
            .ok_or_else(|| LyraError::InvalidInput("task was not stored".into()))
    }

    pub fn list_tasks(&self, list: Option<TaskList>) -> Result<Vec<Task>> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, list, completed, estimated_pomodoros, created_at, updated_at
             FROM tasks WHERE (?1 IS NULL OR list = ?1)
             ORDER BY completed ASC, created_at DESC",
        )?;
        let rows = statement.query_map(params![list.map(TaskList::as_str)], map_task)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_task(&self, id: &str) -> Result<Option<Task>> {
        self.connection
            .query_row(
                "SELECT id, title, list, completed, estimated_pomodoros, created_at, updated_at FROM tasks WHERE id = ?1",
                [id],
                map_task,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn set_task_completed(&self, id: &str, completed: bool) -> Result<()> {
        self.connection.execute(
            "UPDATE tasks SET completed = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, completed, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn move_task(&self, id: &str, list: TaskList) -> Result<()> {
        self.connection.execute(
            "UPDATE tasks SET list = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, list.as_str(), Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn list_timer_presets(&self) -> Result<Vec<TimerPreset>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, focus_minutes, short_break_minutes, long_break_minutes, cycles_before_long_break, built_in FROM timer_presets ORDER BY rowid",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(TimerPreset {
                id: row.get(0)?,
                name: row.get(1)?,
                focus_minutes: row.get(2)?,
                short_break_minutes: row.get(3)?,
                long_break_minutes: row.get(4)?,
                cycles_before_long_break: row.get(5)?,
                built_in: row.get(6)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn save_timer_preset(&self, preset: TimerPreset) -> Result<TimerPreset> {
        if preset.built_in {
            return Err(LyraError::InvalidInput(
                "custom timer preset cannot be marked built-in".into(),
            ));
        }
        if preset.name.trim().is_empty()
            || !(1..=180).contains(&preset.focus_minutes)
            || !(1..=60).contains(&preset.short_break_minutes)
            || !(1..=90).contains(&preset.long_break_minutes)
            || !(1..=12).contains(&preset.cycles_before_long_break)
        {
            return Err(LyraError::InvalidInput(
                "custom timer preset values are out of range".into(),
            ));
        }
        let existing_builtin: Option<bool> = self
            .connection
            .query_row(
                "SELECT built_in FROM timer_presets WHERE id = ?1",
                [&preset.id],
                |row| row.get(0),
            )
            .optional()?;
        if existing_builtin == Some(true) {
            return Err(LyraError::InvalidInput(
                "built-in timer presets cannot be changed".into(),
            ));
        }
        self.connection.execute(
            "INSERT INTO timer_presets(id, name, focus_minutes, short_break_minutes, long_break_minutes, cycles_before_long_break, built_in)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, 0)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, focus_minutes=excluded.focus_minutes,
             short_break_minutes=excluded.short_break_minutes, long_break_minutes=excluded.long_break_minutes,
             cycles_before_long_break=excluded.cycles_before_long_break WHERE timer_presets.built_in = 0",
            params![
                preset.id,
                preset.name.trim(),
                preset.focus_minutes,
                preset.short_break_minutes,
                preset.long_break_minutes,
                preset.cycles_before_long_break,
            ],
        )?;
        Ok(preset)
    }

    pub fn start_focus_session(
        &self,
        task_ids: &[String],
        preset_id: &str,
        music_track_id: Option<&str>,
    ) -> Result<FocusSession> {
        let id = Uuid::new_v4().to_string();
        let started_at = Utc::now().to_rfc3339();
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO focus_sessions(id, preset_id, music_track_id, status, elapsed_seconds, started_at) VALUES(?1, ?2, ?3, 'running', 0, ?4)",
            params![id, preset_id, music_track_id, started_at],
        )?;
        for task_id in task_ids {
            transaction.execute(
                "INSERT INTO focus_session_tasks(session_id, task_id) VALUES(?1, ?2)",
                params![id, task_id],
            )?;
        }
        transaction.commit()?;
        self.get_focus_session(&id)?
            .ok_or_else(|| LyraError::InvalidInput("focus session was not stored".into()))
    }

    pub fn complete_focus_session(
        &self,
        id: &str,
        elapsed_seconds: i64,
        completed_task_ids: &[String],
    ) -> Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        let ended_at = Utc::now().to_rfc3339();
        transaction.execute(
            "UPDATE focus_sessions SET status = 'completed', elapsed_seconds = ?2, ended_at = ?3 WHERE id = ?1 AND status = 'running'",
            params![id, elapsed_seconds, ended_at],
        )?;
        for task_id in completed_task_ids {
            transaction.execute(
                "UPDATE focus_session_tasks SET completed_at_end = 1 WHERE session_id = ?1 AND task_id = ?2",
                params![id, task_id],
            )?;
            transaction.execute(
                "UPDATE tasks SET completed = 1, updated_at = ?2 WHERE id = ?1",
                params![task_id, ended_at],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn interrupt_running_sessions(&self) -> Result<usize> {
        self.connection
            .execute(
                "UPDATE focus_sessions SET status = 'interrupted', ended_at = ?1 WHERE status = 'running'",
                [Utc::now().to_rfc3339()],
            )
            .map_err(Into::into)
    }

    pub fn get_focus_session(&self, id: &str) -> Result<Option<FocusSession>> {
        self.connection
            .query_row(
                "SELECT id, preset_id, music_track_id, status, elapsed_seconds, started_at, ended_at FROM focus_sessions WHERE id = ?1",
                [id],
                |row| {
                    let status: String = row.get(3)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        status,
                        row.get::<_, i64>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, Option<String>>(6)?,
                    ))
                },
            )
            .optional()?
            .map(|(id, preset_id, music_track_id, status, elapsed_seconds, started_at, ended_at)| {
                Ok(FocusSession {
                    id,
                    preset_id,
                    music_track_id,
                    status: FocusSessionStatus::parse(&status)?,
                    elapsed_seconds,
                    started_at,
                    ended_at,
                })
            })
            .transpose()
    }

    pub fn completed_focus_count(&self) -> Result<i64> {
        self.connection
            .query_row(
                "SELECT count(*) FROM focus_sessions WHERE status = ?1",
                [FocusSessionStatus::Completed.as_str()],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub fn save_music_track(&self, input: NewMusicTrack) -> Result<MusicTrackRecord> {
        if !(40..=120).contains(&input.bpm) || !(0..=8).contains(&input.tail_seconds) {
            return Err(LyraError::InvalidInput("invalid track metadata".into()));
        }
        std::fs::create_dir_all(&input.directory)?;
        let id = Uuid::new_v4().to_string();
        let source_path = input.directory.join(format!("{id}.scd"));
        std::fs::write(&source_path, input.source.as_bytes())?;
        let source_sha256 = format!("{:x}", Sha256::digest(input.source.as_bytes()));
        let created_at = Utc::now().to_rfc3339();
        self.connection.execute(
            "INSERT INTO music_tracks(id, parent_track_id, title, description, theme, brightness, density, motion, bpm, tail_seconds, source_path, source_sha256, canonical_seed, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                id,
                input.parent_track_id,
                input.title,
                input.description,
                input.theme,
                input.brightness,
                input.density,
                input.motion,
                input.bpm,
                input.tail_seconds,
                source_path.to_string_lossy(),
                source_sha256,
                input.canonical_seed,
                created_at,
            ],
        )?;
        self.get_music_track(&id)?
            .ok_or_else(|| LyraError::InvalidInput("track was not stored".into()))
    }

    pub fn list_music_tracks(&self) -> Result<Vec<MusicTrackRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, parent_track_id, title, description, theme, brightness, density, motion, bpm, tail_seconds, source_path, source_sha256, canonical_seed, rating, favorite, created_at FROM music_tracks ORDER BY created_at DESC",
        )?;
        let rows = statement.query_map([], map_music_track)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_music_track(&self, id: &str) -> Result<Option<MusicTrackRecord>> {
        self.connection
            .query_row(
                "SELECT id, parent_track_id, title, description, theme, brightness, density, motion, bpm, tail_seconds, source_path, source_sha256, canonical_seed, rating, favorite, created_at FROM music_tracks WHERE id = ?1",
                [id],
                map_music_track,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn rate_music_track(&self, id: &str, rating: Option<&str>, favorite: bool) -> Result<()> {
        if rating.is_some_and(|value| value != "good" && value != "poor") {
            return Err(LyraError::InvalidInput(
                "rating must be good, poor, or null".into(),
            ));
        }
        self.connection.execute(
            "UPDATE music_tracks SET rating = ?2, favorite = ?3 WHERE id = ?1",
            params![id, rating, favorite],
        )?;
        Ok(())
    }
}

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let list: String = row.get(2)?;
    let list = TaskList::parse(&list).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        list,
        completed: row.get(3)?,
        estimated_pomodoros: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn map_music_track(row: &rusqlite::Row<'_>) -> rusqlite::Result<MusicTrackRecord> {
    Ok(MusicTrackRecord {
        id: row.get(0)?,
        parent_track_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        theme: row.get(4)?,
        brightness: row.get(5)?,
        density: row.get(6)?,
        motion: row.get(7)?,
        bpm: row.get(8)?,
        tail_seconds: row.get(9)?,
        source_path: row.get(10)?,
        source_sha256: row.get(11)?,
        canonical_seed: row.get(12)?,
        rating: row.get(13)?,
        favorite: row.get(14)?,
        created_at: row.get(15)?,
    })
}

pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}
