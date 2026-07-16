use chrono::{DateTime, Datelike, Months, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
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

fn deserialize_double_option<'de, D, T>(
    deserializer: D,
) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::<T>::deserialize(deserializer)?))
}

fn sync_directory(path: &Path) -> std::io::Result<()> {
    std::fs::File::open(path)?.sync_all()
}

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    #[default]
    Inbox,
    Active,
    Completed,
}

impl TaskStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Inbox => "inbox",
            Self::Active => "active",
            Self::Completed => "completed",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "inbox" => Ok(Self::Inbox),
            "active" => Ok(Self::Active),
            "completed" => Ok(Self::Completed),
            other => Err(LyraError::InvalidInput(format!(
                "unknown task status: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    #[default]
    None,
    Low,
    Medium,
    High,
}

impl TaskPriority {
    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "none" => Ok(Self::None),
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            other => Err(LyraError::InvalidInput(format!(
                "unknown task priority: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Recurrence {
    Daily,
    Weekly,
    Monthly,
}

impl Recurrence {
    fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            "monthly" => Ok(Self::Monthly),
            other => Err(LyraError::InvalidInput(format!(
                "unknown recurrence: {other}"
            ))),
        }
    }

    pub fn next_date(self, date: &str) -> Result<String> {
        self.next_date_with_anchor(date, None)
    }

    fn next_date_with_anchor(self, date: &str, anchor_day: Option<u32>) -> Result<String> {
        let current = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| LyraError::InvalidInput("date must use YYYY-MM-DD".into()))?;
        let next = match self {
            Self::Daily => current.succ_opt(),
            Self::Weekly => current.checked_add_days(chrono::Days::new(7)),
            Self::Monthly => {
                let first = current
                    .with_day(1)
                    .and_then(|value| value.checked_add_months(Months::new(1)))
                    .ok_or_else(|| {
                        LyraError::InvalidInput("recurrence date is out of range".into())
                    })?;
                let following = first.checked_add_months(Months::new(1));
                let last_day = following
                    .and_then(|value| value.pred_opt())
                    .map(|value| value.day())
                    .unwrap_or(31);
                first.with_day(anchor_day.unwrap_or(current.day()).min(last_day))
            }
        }
        .ok_or_else(|| LyraError::InvalidInput("recurrence date is out of range".into()))?;
        Ok(next.format("%Y-%m-%d").to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub list: TaskList,
    pub completed: bool,
    pub estimated_pomodoros: Option<i64>,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub notes: String,
    pub planned_date: Option<String>,
    pub due_date: Option<String>,
    pub position: i64,
    pub completed_at: Option<String>,
    pub recurrence: Option<Recurrence>,
    #[serde(skip)]
    pub recurrence_anchor_day: Option<u32>,
    pub tags: Vec<Tag>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTaskV2 {
    pub title: String,
    #[serde(default)]
    pub status: TaskStatus,
    #[serde(default)]
    pub priority: TaskPriority,
    pub estimated_pomodoros: Option<i64>,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub notes: String,
    pub planned_date: Option<String>,
    pub due_date: Option<String>,
    pub recurrence: Option<Recurrence>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTask {
    pub title: Option<String>,
    pub status: Option<TaskStatus>,
    pub priority: Option<TaskPriority>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub estimated_pomodoros: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub project_id: Option<Option<String>>,
    pub notes: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub planned_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub recurrence: Option<Option<Recurrence>>,
    pub tag_ids: Option<Vec<String>>,
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
            next.phase = TimerPhase::Focus;
            next.remaining_seconds = (state.preset.focus_minutes * 60) as u64;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoodSelection {
    pub mood_id: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MusicRecipeV1 {
    pub version: u8,
    pub moods: Vec<MoodSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MoodVectors {
    pub brightness: f64,
    pub density: f64,
    pub motion: f64,
    pub warmth: f64,
    pub space: f64,
    pub pulse: f64,
    pub melody: f64,
    pub organic: f64,
}

impl MoodVectors {
    fn zero() -> Self {
        Self {
            brightness: 0.0,
            density: 0.0,
            motion: 0.0,
            warmth: 0.0,
            space: 0.0,
            pulse: 0.0,
            melody: 0.0,
            organic: 0.0,
        }
    }

    fn add_weighted(&mut self, other: &Self, weight: f64) {
        self.brightness += other.brightness * weight;
        self.density += other.density * weight;
        self.motion += other.motion * weight;
        self.warmth += other.warmth * weight;
        self.space += other.space * weight;
        self.pulse += other.pulse * weight;
        self.melody += other.melody * weight;
        self.organic += other.organic * weight;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMusicRecipe {
    pub recipe: MusicRecipeV1,
    pub vectors: MoodVectors,
    pub structure_family: String,
    pub tempo_min: u16,
    pub tempo_max: u16,
    pub timbre_guidance: String,
}

#[derive(Debug, Deserialize)]
struct MoodCatalog {
    version: u8,
    categories: Vec<MoodCategory>,
}

#[derive(Debug, Deserialize)]
struct MoodCategory {
    moods: Vec<MoodDefinition>,
}

#[derive(Debug, Deserialize)]
struct MoodDefinition {
    id: String,
    vectors: MoodVectors,
}

impl MusicRecipeV1 {
    pub fn resolve(&self) -> Result<ResolvedMusicRecipe> {
        if self.version != 1 {
            return Err(LyraError::InvalidInput(
                "music recipe version must be 1".into(),
            ));
        }
        if !(1..=5).contains(&self.moods.len()) {
            return Err(LyraError::InvalidInput(
                "music recipe must contain 1 to 5 moods".into(),
            ));
        }
        let catalog: MoodCatalog =
            serde_json::from_str(include_str!("../../../apps/desktop/shared/moods.v1.json"))
                .map_err(|error| {
                    LyraError::InvalidInput(format!("invalid bundled mood catalog: {error}"))
                })?;
        if catalog.version != 1 {
            return Err(LyraError::InvalidInput(
                "bundled mood catalog version mismatch".into(),
            ));
        }
        let definitions: HashMap<_, _> = catalog
            .categories
            .iter()
            .flat_map(|category| category.moods.iter())
            .map(|mood| (mood.id.as_str(), &mood.vectors))
            .collect();
        let mut seen = HashSet::new();
        let mut total = 0.0;
        for mood in &self.moods {
            if !seen.insert(mood.mood_id.as_str()) {
                return Err(LyraError::InvalidInput(
                    "music recipe mood IDs must be unique".into(),
                ));
            }
            if !definitions.contains_key(mood.mood_id.as_str()) {
                return Err(LyraError::InvalidInput(format!(
                    "unknown mood ID: {}",
                    mood.mood_id
                )));
            }
            if !mood.weight.is_finite() || !(0.0..=1.0).contains(&mood.weight) || mood.weight == 0.0
            {
                return Err(LyraError::InvalidInput(
                    "music recipe weights must be finite and greater than 0 through 1".into(),
                ));
            }
            total += mood.weight;
        }
        if !total.is_finite() || total <= 0.0 {
            return Err(LyraError::InvalidInput(
                "music recipe weight total must be positive".into(),
            ));
        }
        let normalized_moods = self
            .moods
            .iter()
            .map(|mood| MoodSelection {
                mood_id: mood.mood_id.clone(),
                weight: mood.weight / total,
            })
            .collect::<Vec<_>>();
        let mut vectors = MoodVectors::zero();
        for mood in &normalized_moods {
            vectors.add_weighted(definitions[mood.mood_id.as_str()], mood.weight);
        }
        let structure_family = if vectors.organic > 0.76 && vectors.pulse > 0.42 {
            "organic-pulse"
        } else if vectors.melody > 0.68 && vectors.motion < 0.45 {
            "neoclassical"
        } else if vectors.melody > 0.58 {
            "minimal-melody"
        } else if vectors.pulse > 0.66 {
            "lofi"
        } else if vectors.motion > 0.52 {
            "downtempo"
        } else {
            "ambient"
        }
        .to_string();
        let center_bpm = 54.0 + vectors.pulse * 34.0 + vectors.motion * 10.0;
        let tempo_min = (center_bpm - 6.0).round().clamp(48.0, 100.0) as u16;
        let tempo_max = (center_bpm + 6.0).round().clamp(54.0, 108.0) as u16;
        let timbre_guidance = format!(
            "warmth {:.2}, space {:.2}, organic {:.2}; use soft, band-limited timbres",
            vectors.warmth, vectors.space, vectors.organic
        );
        Ok(ResolvedMusicRecipe {
            recipe: MusicRecipeV1 {
                version: 1,
                moods: normalized_moods,
            },
            vectors,
            structure_family,
            tempo_min,
            tempo_max,
            timbre_guidance,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrackRecord {
    pub id: String,
    pub parent_track_id: Option<String>,
    pub title: String,
    pub description: String,
    pub theme: String,
    pub arrangement: String,
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
    pub recipe_version: Option<i64>,
    pub recipe_json: Option<String>,
    pub structure_family: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewMusicTrack {
    pub parent_track_id: Option<String>,
    pub title: String,
    pub description: String,
    pub theme: String,
    pub arrangement: String,
    pub brightness: String,
    pub density: String,
    pub motion: String,
    pub bpm: i64,
    pub tail_seconds: i64,
    pub source: String,
    pub canonical_seed: i64,
    pub directory: PathBuf,
    pub recipe_version: Option<i64>,
    pub recipe_json: Option<String>,
    pub structure_family: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MusicTrackSort {
    #[default]
    CreatedDesc,
    CreatedAsc,
    TitleAsc,
    TitleDesc,
    BpmAsc,
    BpmDesc,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrackListQuery {
    pub query: Option<String>,
    pub favorite: Option<bool>,
    pub structure_family: Option<String>,
    #[serde(default)]
    pub sort: MusicTrackSort,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMusicTracksResult {
    pub deleted_ids: Vec<String>,
    pub unlinked_child_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicDeleteJournal {
    entries: Vec<MusicDeleteJournalEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicDeleteJournalEntry {
    id: String,
    original_path: PathBuf,
    quarantined_path: PathBuf,
}

trait MusicDeleteFileOps {
    fn rename(&mut self, from: &Path, to: &Path) -> std::io::Result<()>;
    fn purge(&mut self, directory: &Path) -> std::io::Result<()>;
}

struct StandardMusicDeleteFileOps;

impl MusicDeleteFileOps for StandardMusicDeleteFileOps {
    fn rename(&mut self, from: &Path, to: &Path) -> std::io::Result<()> {
        std::fs::rename(from, to)
    }

    fn purge(&mut self, directory: &Path) -> std::io::Result<()> {
        std::fs::remove_dir_all(directory)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsV2 {
    pub version: u8,
    pub close_behavior: String,
    pub launch_at_login: bool,
    pub default_preset_id: String,
    pub auto_start_break: bool,
    pub notifications_enabled: bool,
    pub master_volume: f64,
    pub play_selected_track_on_focus: bool,
    pub crossfade_seconds: f64,
}

impl Default for AppSettingsV2 {
    fn default() -> Self {
        Self {
            version: 2,
            close_behavior: "hide".into(),
            launch_at_login: false,
            default_preset_id: "standard".into(),
            auto_start_break: false,
            notifications_enabled: true,
            master_volume: 1.5,
            play_selected_track_on_focus: true,
            crossfade_seconds: 2.0,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAppSettingsV1 {
    version: u8,
    close_behavior: String,
    launch_at_login: bool,
    default_preset_id: String,
    auto_start_break: bool,
    notifications_enabled: bool,
    master_volume: f64,
    play_selected_track_on_focus: bool,
    crossfade_seconds: f64,
}

impl From<LegacyAppSettingsV1> for AppSettingsV2 {
    fn from(settings: LegacyAppSettingsV1) -> Self {
        Self {
            version: 2,
            close_behavior: settings.close_behavior,
            launch_at_login: settings.launch_at_login,
            default_preset_id: settings.default_preset_id,
            auto_start_break: settings.auto_start_break,
            notifications_enabled: settings.notifications_enabled,
            master_volume: if settings.master_volume == 1.0 {
                1.5
            } else {
                settings.master_volume
            },
            play_selected_track_on_focus: settings.play_selected_track_on_focus,
            crossfade_seconds: settings.crossfade_seconds,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnostic {
    pub component: String,
    pub status: String,
    pub message: String,
    pub remediation: Option<String>,
}

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        let database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    pub fn open_in_memory() -> Result<Self> {
        let connection = Connection::open_in_memory()?;
        connection.busy_timeout(Duration::from_secs(5))?;
        let database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    fn migrate(&self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            "#,
        )?;
        let transaction =
            Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        transaction.execute_batch(
            r#"

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
        let version: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        if version < 2 {
            transaction.execute_batch(
                r#"
                ALTER TABLE music_tracks ADD COLUMN arrangement TEXT NOT NULL DEFAULT 'ambient'
                  CHECK(arrangement IN ('ambient', 'lofi', 'minimal-melody'));
                INSERT INTO schema_migrations(version, applied_at)
                  VALUES(2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
                "#,
            )?;
        }
        if version < 3 {
            transaction.execute_batch(
                r#"
                UPDATE focus_sessions SET music_track_id = NULL;
                DELETE FROM music_tracks;
                INSERT INTO schema_migrations(version, applied_at)
                  VALUES(3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
                "#,
            )?;
        }
        if version < 4 {
            transaction.execute_batch(
                r#"
                ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'inbox'
                  CHECK(status IN ('inbox', 'active', 'completed'));
                ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'none'
                  CHECK(priority IN ('none', 'low', 'medium', 'high'));
                ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
                ALTER TABLE tasks ADD COLUMN parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE;
                ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT '';
                ALTER TABLE tasks ADD COLUMN planned_date TEXT;
                ALTER TABLE tasks ADD COLUMN due_date TEXT;
                ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE tasks ADD COLUMN completed_at TEXT;
                ALTER TABLE tasks ADD COLUMN recurrence TEXT CHECK(recurrence IN ('daily', 'weekly', 'monthly'));
                ALTER TABLE tasks ADD COLUMN recurrence_anchor_day INTEGER
                  CHECK(recurrence_anchor_day BETWEEN 1 AND 31);

                CREATE TABLE projects (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
                  color TEXT,
                  position INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE tags (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 50)
                );
                CREATE TABLE task_tags (
                  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                  PRIMARY KEY(task_id, tag_id)
                );
                CREATE INDEX task_status_position_idx ON tasks(status, position);
                CREATE INDEX task_planned_date_idx ON tasks(planned_date);
                CREATE INDEX task_due_date_idx ON tasks(due_date);

                UPDATE tasks SET
                  status = CASE
                    WHEN completed = 1 THEN 'completed'
                    WHEN list = 'today' THEN 'active'
                    ELSE 'inbox'
                  END,
                  planned_date = CASE
                    WHEN completed = 0 AND list = 'today' THEN date('now', 'localtime')
                    ELSE planned_date
                  END,
                  completed_at = CASE WHEN completed = 1 THEN updated_at ELSE NULL END,
                  position = rowid;

                INSERT INTO schema_migrations(version, applied_at)
                  VALUES(4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
                "#,
            )?;
        }
        if version < 5 {
            transaction.execute_batch(
                r#"
                ALTER TABLE music_tracks RENAME TO music_tracks_v4;
                ALTER TABLE focus_sessions RENAME TO focus_sessions_v4;
                ALTER TABLE focus_session_tasks RENAME TO focus_session_tasks_v4;
                CREATE TABLE music_tracks (
                  id TEXT PRIMARY KEY,
                  parent_track_id TEXT REFERENCES music_tracks(id) ON DELETE SET NULL,
                  title TEXT NOT NULL,
                  description TEXT NOT NULL,
                  theme TEXT NOT NULL,
                  arrangement TEXT NOT NULL CHECK(arrangement IN ('ambient', 'lofi', 'minimal-melody', 'organic-pulse', 'downtempo', 'neoclassical')),
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
                  recipe_version INTEGER,
                  recipe_json TEXT,
                  structure_family TEXT,
                  created_at TEXT NOT NULL
                );
                INSERT INTO music_tracks(
                  id, parent_track_id, title, description, theme, arrangement, brightness,
                  density, motion, bpm, tail_seconds, source_path, source_sha256, canonical_seed,
                  rating, favorite, recipe_version, recipe_json, structure_family, created_at
                )
                SELECT id, parent_track_id, title, description, theme, arrangement, brightness,
                  density, motion, bpm, tail_seconds, source_path, source_sha256, canonical_seed,
                  rating, favorite, 0,
                  '{"version":0,"legacy":{"theme":"' || replace(theme, '"', '') ||
                  '","arrangement":"' || replace(arrangement, '"', '') ||
                  '","brightness":"' || replace(brightness, '"', '') ||
                  '","density":"' || replace(density, '"', '') ||
                  '","motion":"' || replace(motion, '"', '') || '"}}',
                  arrangement, created_at
                FROM music_tracks_v4;
                CREATE TABLE focus_sessions (
                  id TEXT PRIMARY KEY,
                  preset_id TEXT NOT NULL,
                  music_track_id TEXT REFERENCES music_tracks(id) ON DELETE SET NULL,
                  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'interrupted')),
                  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
                  started_at TEXT NOT NULL,
                  ended_at TEXT
                );
                INSERT INTO focus_sessions(
                  id, preset_id, music_track_id, status, elapsed_seconds, started_at, ended_at
                )
                SELECT id, preset_id, music_track_id, status, elapsed_seconds, started_at, ended_at
                FROM focus_sessions_v4;
                CREATE TABLE focus_session_tasks (
                  session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
                  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                  completed_at_end INTEGER NOT NULL DEFAULT 0,
                  PRIMARY KEY(session_id, task_id)
                );
                INSERT INTO focus_session_tasks(session_id, task_id, completed_at_end)
                SELECT session_id, task_id, completed_at_end FROM focus_session_tasks_v4;
                DROP TABLE focus_session_tasks_v4;
                DROP TABLE focus_sessions_v4;
                DROP TABLE music_tracks_v4;
                INSERT INTO schema_migrations(version, applied_at)
                  VALUES(5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
                "#,
            )?;
        }
        transaction.commit()?;
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
        let status = match input.list {
            TaskList::Today => TaskStatus::Active,
            TaskList::Backlog => TaskStatus::Inbox,
        };
        let planned_date = (input.list == TaskList::Today).then(|| {
            chrono::Local::now()
                .date_naive()
                .format("%Y-%m-%d")
                .to_string()
        });
        let position: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM tasks WHERE status = ?1",
            [status.as_str()],
            |row| row.get(0),
        )?;
        self.connection.execute(
            "INSERT INTO tasks(id, title, list, completed, estimated_pomodoros, status, priority, planned_date, position, created_at, updated_at) VALUES(?1, ?2, ?3, 0, ?4, ?5, 'none', ?6, ?7, ?8, ?8)",
            params![id, title, input.list.as_str(), input.estimated_pomodoros, status.as_str(), planned_date, position, now],
        )?;
        self.get_task(&id)?
            .ok_or_else(|| LyraError::InvalidInput("task was not stored".into()))
    }

    pub fn list_tasks(&self, list: Option<TaskList>) -> Result<Vec<Task>> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, list, completed, estimated_pomodoros, status, priority,
                    project_id, parent_id, notes, planned_date, due_date, position, completed_at,
                    recurrence, recurrence_anchor_day, created_at, updated_at
             FROM tasks WHERE (?1 IS NULL OR list = ?1)
             ORDER BY completed ASC, position ASC, created_at DESC",
        )?;
        let rows = statement.query_map(params![list.map(TaskList::as_str)], map_task)?;
        let mut tasks = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        for task in &mut tasks {
            task.tags = self.list_task_tags(&task.id)?;
        }
        Ok(tasks)
    }

    pub fn get_task(&self, id: &str) -> Result<Option<Task>> {
        self.connection
            .query_row(
                "SELECT id, title, list, completed, estimated_pomodoros, status, priority, project_id, parent_id, notes, planned_date, due_date, position, completed_at, recurrence, recurrence_anchor_day, created_at, updated_at FROM tasks WHERE id = ?1",
                [id],
                map_task,
            )
            .optional()?
            .map(|mut task| {
                task.tags = self.list_task_tags(&task.id)?;
                Ok(task)
            })
            .transpose()
    }

    pub fn set_task_completed(&self, id: &str, completed: bool) -> Result<()> {
        let Some(task) = self.get_task(id)? else {
            return Err(LyraError::InvalidInput("task was not found".into()));
        };
        let now = Utc::now().to_rfc3339();
        let transaction = self.connection.unchecked_transaction()?;
        Self::transition_task_completion(&transaction, &task, completed, &now)?;
        transaction.commit()?;
        Ok(())
    }

    fn transition_task_completion(
        transaction: &Transaction<'_>,
        task: &Task,
        completed: bool,
        now: &str,
    ) -> Result<bool> {
        if !completed {
            let status = if task.list == TaskList::Today {
                TaskStatus::Active
            } else {
                TaskStatus::Inbox
            };
            let changed = transaction.execute(
                "UPDATE tasks SET completed = 0, status = ?2, completed_at = NULL, updated_at = ?3 WHERE id = ?1",
                params![task.id, status.as_str(), now],
            )?;
            return Ok(changed == 1);
        }

        let changed = transaction.execute(
            "UPDATE tasks SET completed = 1, status = 'completed', completed_at = ?2, updated_at = ?2 WHERE id = ?1 AND completed = 0",
            params![task.id, now],
        )?;
        if changed == 0 {
            return Ok(false);
        }
        if let Some(recurrence) = task.recurrence {
            let base = recurrence_base_date(task)?;
            let anchor_day = task.recurrence_anchor_day.or_else(|| {
                NaiveDate::parse_from_str(base, "%Y-%m-%d")
                    .ok()
                    .map(|date| date.day())
            });
            let next_planned_date = task
                .planned_date
                .as_deref()
                .map(|date| recurrence.next_date_with_anchor(date, anchor_day))
                .transpose()?;
            let next_due_date = match (
                task.planned_date.as_deref(),
                task.due_date.as_deref(),
                next_planned_date.as_deref(),
            ) {
                (Some(planned), Some(due), Some(next_planned)) => {
                    let planned = NaiveDate::parse_from_str(planned, "%Y-%m-%d")
                        .map_err(|_| LyraError::InvalidInput("date must use YYYY-MM-DD".into()))?;
                    let due = NaiveDate::parse_from_str(due, "%Y-%m-%d")
                        .map_err(|_| LyraError::InvalidInput("date must use YYYY-MM-DD".into()))?;
                    let next_planned = NaiveDate::parse_from_str(next_planned, "%Y-%m-%d")
                        .map_err(|_| LyraError::InvalidInput("date is out of range".into()))?;
                    Some(
                        next_planned
                            .checked_add_signed(due.signed_duration_since(planned))
                            .ok_or_else(|| {
                                LyraError::InvalidInput("recurrence date is out of range".into())
                            })?
                            .format("%Y-%m-%d")
                            .to_string(),
                    )
                }
                (_, Some(due), _) => Some(recurrence.next_date_with_anchor(due, anchor_day)?),
                _ => None,
            };
            let next_id = Uuid::new_v4().to_string();
            transaction.execute(
                "INSERT INTO tasks(id, title, list, completed, estimated_pomodoros, status, priority, project_id, notes, planned_date, due_date, position, recurrence, recurrence_anchor_day, created_at, updated_at)
                 VALUES(?1, ?2, 'today', 0, ?3, 'active', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
                params![next_id, task.title, task.estimated_pomodoros, task.priority.as_str(), task.project_id, task.notes,
                    next_planned_date, next_due_date, task.position,
                    recurrence.as_str(), anchor_day, now],
            )?;
            transaction.execute(
                "INSERT INTO task_tags(task_id, tag_id) SELECT ?1, tag_id FROM task_tags WHERE task_id = ?2",
                params![next_id, task.id],
            )?;
        }
        Ok(true)
    }

    pub fn move_task(&self, id: &str, list: TaskList) -> Result<()> {
        let status = match list {
            TaskList::Today => TaskStatus::Active,
            TaskList::Backlog => TaskStatus::Inbox,
        };
        self.connection.execute(
            "UPDATE tasks SET list = ?2, status = CASE WHEN completed = 1 THEN 'completed' ELSE ?3 END, planned_date = CASE WHEN ?2 = 'today' AND planned_date IS NULL THEN date('now', 'localtime') ELSE planned_date END, updated_at = ?4 WHERE id = ?1",
            params![id, list.as_str(), status.as_str(), Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn add_task_v2(&self, input: AddTaskV2) -> Result<Task> {
        validate_task_title(&input.title)?;
        validate_task_dates(input.planned_date.as_deref(), input.due_date.as_deref())?;
        if input.recurrence.is_some() && input.parent_id.is_some() {
            return Err(LyraError::InvalidInput(
                "recurring tasks cannot be subtasks".into(),
            ));
        }
        if input.status == TaskStatus::Completed && input.recurrence.is_some() {
            return Err(LyraError::InvalidInput(
                "completed tasks cannot be created with recurrence".into(),
            ));
        }
        if input.recurrence.is_some() && input.planned_date.is_none() && input.due_date.is_none() {
            return Err(LyraError::InvalidInput(
                "recurring task requires a planned or due date".into(),
            ));
        }
        if let Some(parent_id) = input.parent_id.as_deref() {
            let parent = self
                .get_task(parent_id)?
                .ok_or_else(|| LyraError::InvalidInput("parent task was not found".into()))?;
            if parent.parent_id.is_some() {
                return Err(LyraError::InvalidInput(
                    "subtasks can only be one level deep".into(),
                ));
            }
            if parent.recurrence.is_some() {
                return Err(LyraError::InvalidInput(
                    "recurring tasks cannot have subtasks".into(),
                ));
            }
        }
        validate_estimate(input.estimated_pomodoros)?;
        let planned_date = input.planned_date.clone().or_else(|| {
            (input.status == TaskStatus::Active && input.due_date.is_none()).then(|| {
                chrono::Local::now()
                    .date_naive()
                    .format("%Y-%m-%d")
                    .to_string()
            })
        });
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let list = if input.status == TaskStatus::Active {
            TaskList::Today
        } else {
            TaskList::Backlog
        };
        let recurrence_anchor_day = recurrence_anchor_day(
            input.recurrence,
            planned_date.as_deref(),
            input.due_date.as_deref(),
        )?;
        let position: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM tasks WHERE status = ?1",
            [input.status.as_str()],
            |row| row.get(0),
        )?;
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO tasks(id,title,list,completed,estimated_pomodoros,status,priority,project_id,parent_id,notes,planned_date,due_date,position,completed_at,recurrence,recurrence_anchor_day,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)",
            params![id, input.title.trim(), list.as_str(), input.status == TaskStatus::Completed, input.estimated_pomodoros, input.status.as_str(), input.priority.as_str(), input.project_id, input.parent_id, input.notes.trim(), planned_date, input.due_date, position, (input.status == TaskStatus::Completed).then_some(now.as_str()), input.recurrence.map(Recurrence::as_str), recurrence_anchor_day, now],
        )?;
        for tag_id in input.tag_ids {
            transaction.execute(
                "INSERT INTO task_tags(task_id, tag_id) VALUES(?1, ?2)",
                params![id, tag_id],
            )?;
        }
        transaction.commit()?;
        self.get_task(&id)?
            .ok_or_else(|| LyraError::InvalidInput("task was not stored".into()))
    }

    pub fn reorder_tasks(&self, ordered_ids: &[String], status: TaskStatus) -> Result<()> {
        let unique = ordered_ids.iter().collect::<HashSet<_>>();
        let expected: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM tasks WHERE status = ?1",
            [status.as_str()],
            |row| row.get(0),
        )?;
        if unique.len() != ordered_ids.len() || ordered_ids.len() != expected as usize {
            return Err(LyraError::InvalidInput(
                "task reorder must contain every unique task in the status scope".into(),
            ));
        }
        let transaction = self.connection.unchecked_transaction()?;
        for (position, id) in ordered_ids.iter().enumerate() {
            let changed = transaction.execute(
                "UPDATE tasks SET position = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?2",
                params![
                    id,
                    status.as_str(),
                    position as i64,
                    Utc::now().to_rfc3339()
                ],
            )?;
            if changed != 1 {
                return Err(LyraError::InvalidInput(
                    "task reorder scope does not match task status".into(),
                ));
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn update_task(&self, id: &str, input: UpdateTask) -> Result<Task> {
        let current = self
            .get_task(id)?
            .ok_or_else(|| LyraError::InvalidInput("task was not found".into()))?;
        let title = input
            .title
            .as_deref()
            .unwrap_or(&current.title)
            .trim()
            .to_string();
        validate_task_title(&title)?;
        let status = input.status.unwrap_or(current.status);
        let priority = input.priority.unwrap_or(current.priority);
        let estimate = input
            .estimated_pomodoros
            .unwrap_or(current.estimated_pomodoros);
        validate_estimate(estimate)?;
        let project_id = input.project_id.unwrap_or(current.project_id.clone());
        let notes = input
            .notes
            .unwrap_or(current.notes.clone())
            .trim()
            .to_string();
        let dates_changed = input.planned_date.is_some() || input.due_date.is_some();
        let planned_date = input.planned_date.unwrap_or(current.planned_date.clone());
        let due_date = input.due_date.unwrap_or(current.due_date.clone());
        validate_task_dates(planned_date.as_deref(), due_date.as_deref())?;
        let recurrence = input.recurrence.unwrap_or(current.recurrence);
        if recurrence.is_some() && current.parent_id.is_some() {
            return Err(LyraError::InvalidInput(
                "recurring tasks cannot be subtasks".into(),
            ));
        }
        if recurrence.is_some() {
            let has_subtasks: bool = self.connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM tasks WHERE parent_id = ?1)",
                [id],
                |row| row.get(0),
            )?;
            if has_subtasks {
                return Err(LyraError::InvalidInput(
                    "recurring tasks cannot have subtasks".into(),
                ));
            }
        }
        if recurrence.is_some() && planned_date.is_none() && due_date.is_none() {
            return Err(LyraError::InvalidInput(
                "recurring task requires a planned or due date".into(),
            ));
        }
        let completed = status == TaskStatus::Completed;
        let now = Utc::now().to_rfc3339();
        let list = if status == TaskStatus::Active {
            TaskList::Today
        } else {
            TaskList::Backlog
        };
        let recurrence_anchor_day = if recurrence == Some(Recurrence::Monthly)
            && !dates_changed
            && current.recurrence == Some(Recurrence::Monthly)
        {
            current.recurrence_anchor_day
        } else {
            recurrence_anchor_day(recurrence, planned_date.as_deref(), due_date.as_deref())?
        };
        let mut updated = current.clone();
        updated.title = title.clone();
        updated.list = list;
        updated.estimated_pomodoros = estimate;
        updated.status = status;
        updated.priority = priority;
        updated.project_id = project_id.clone();
        updated.notes = notes.clone();
        updated.planned_date = planned_date.clone();
        updated.due_date = due_date.clone();
        updated.recurrence = recurrence;
        updated.recurrence_anchor_day = recurrence_anchor_day;

        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "UPDATE tasks SET title=?2,list=?3,estimated_pomodoros=?4,priority=?5,project_id=?6,notes=?7,planned_date=?8,due_date=?9,recurrence=?10,recurrence_anchor_day=?11,updated_at=?12 WHERE id=?1",
            params![id,title,list.as_str(),estimate,priority.as_str(),project_id,notes,planned_date,due_date,recurrence.map(Recurrence::as_str),recurrence_anchor_day,now],
        )?;
        if let Some(tag_ids) = input.tag_ids {
            transaction.execute("DELETE FROM task_tags WHERE task_id = ?1", [id])?;
            for tag_id in tag_ids {
                transaction.execute(
                    "INSERT INTO task_tags(task_id, tag_id) VALUES(?1, ?2)",
                    params![id, tag_id],
                )?;
            }
        }
        Self::transition_task_completion(&transaction, &updated, completed, &now)?;
        transaction.commit()?;
        self.get_task(id)?
            .ok_or_else(|| LyraError::InvalidInput("task was not found".into()))
    }

    fn list_task_tags(&self, task_id: &str) -> Result<Vec<Tag>> {
        let mut statement = self.connection.prepare("SELECT tags.id, tags.name FROM tags JOIN task_tags ON task_tags.tag_id = tags.id WHERE task_tags.task_id = ?1 ORDER BY tags.name COLLATE NOCASE")?;
        let rows = statement.query_map([task_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, color, position FROM projects ORDER BY position, name COLLATE NOCASE",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                position: row.get(3)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn save_project(&self, project: Project) -> Result<Project> {
        let name = project.name.trim();
        if name.is_empty() || name.chars().count() > 100 {
            return Err(LyraError::InvalidInput(
                "project name must contain 1 to 100 characters".into(),
            ));
        }
        let id = if project.id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            project.id
        };
        self.connection.execute(
            "INSERT INTO projects(id,name,color,position) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,position=excluded.position",
            params![id, name, project.color, project.position],
        )?;
        Ok(Project {
            id,
            name: name.into(),
            color: project.color,
            position: project.position,
        })
    }

    pub fn list_tags(&self) -> Result<Vec<Tag>> {
        let mut statement = self
            .connection
            .prepare("SELECT id, name FROM tags ORDER BY name COLLATE NOCASE")?;
        let rows = statement.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn save_tag(&self, tag: Tag) -> Result<Tag> {
        let name = tag.name.trim();
        if name.is_empty() || name.chars().count() > 50 {
            return Err(LyraError::InvalidInput(
                "tag name must contain 1 to 50 characters".into(),
            ));
        }
        let id = if tag.id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            tag.id
        };
        self.connection.execute(
            "INSERT INTO tags(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
            params![id, name],
        )?;
        Ok(Tag {
            id,
            name: name.into(),
        })
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

    pub fn delete_timer_preset(&self, id: &str) -> Result<()> {
        let built_in: Option<bool> = self
            .connection
            .query_row(
                "SELECT built_in FROM timer_presets WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?;
        match built_in {
            Some(true) => Err(LyraError::InvalidInput(
                "built-in timer presets cannot be deleted".into(),
            )),
            Some(false) => {
                if self.get_app_settings()?.default_preset_id == id {
                    return Err(LyraError::InvalidInput(
                        "default timer preset cannot be deleted".into(),
                    ));
                }
                self.connection
                    .execute("DELETE FROM timer_presets WHERE id = ?1", [id])?;
                Ok(())
            }
            None => Err(LyraError::InvalidInput("timer preset was not found".into())),
        }
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        self.connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(Into::into)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_app_settings(&self) -> Result<AppSettingsV2> {
        if let Some(value) = self.get_setting("app.settings.v2")? {
            let settings = serde_json::from_str(&value).map_err(|error| {
                LyraError::InvalidInput(format!("stored app settings are invalid: {error}"))
            })?;
            self.validate_app_settings(&settings)?;
            return Ok(settings);
        }
        let settings = if let Some(value) = self.get_setting("app.settings.v1")? {
            let legacy: LegacyAppSettingsV1 = serde_json::from_str(&value).map_err(|error| {
                LyraError::InvalidInput(format!("stored app settings are invalid: {error}"))
            })?;
            if legacy.version != 1 {
                return Err(LyraError::InvalidInput(
                    "stored app settings are invalid: legacy version is not 1".into(),
                ));
            }
            legacy.into()
        } else {
            AppSettingsV2::default()
        };
        self.save_app_settings(&settings)
    }

    pub fn save_app_settings(&self, settings: &AppSettingsV2) -> Result<AppSettingsV2> {
        self.validate_app_settings(settings)?;
        let json = serde_json::to_string(settings).map_err(|error| {
            LyraError::InvalidInput(format!("app settings could not be encoded: {error}"))
        })?;
        self.set_setting("app.settings.v2", &json)?;
        Ok(settings.clone())
    }

    pub fn validate_app_settings(&self, settings: &AppSettingsV2) -> Result<()> {
        if settings.version != 2
            || !matches!(settings.close_behavior.as_str(), "hide" | "quit")
            || settings.default_preset_id.trim().is_empty()
            || !settings.master_volume.is_finite()
            || !(0.0..=2.0).contains(&settings.master_volume)
            || !settings.crossfade_seconds.is_finite()
            || !(0.0..=10.0).contains(&settings.crossfade_seconds)
        {
            return Err(LyraError::InvalidInput(
                "app settings values are out of range".into(),
            ));
        }
        if !self
            .list_timer_presets()?
            .iter()
            .any(|preset| preset.id == settings.default_preset_id)
        {
            return Err(LyraError::InvalidInput(
                "default timer preset was not found".into(),
            ));
        }
        Ok(())
    }

    pub fn sqlite_diagnostic(&self) -> RuntimeDiagnostic {
        match self
            .connection
            .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        {
            Ok(message) if message == "ok" => RuntimeDiagnostic {
                component: "sqlite".into(),
                status: "ok".into(),
                message: "SQLite integrity check passed".into(),
                remediation: None,
            },
            Ok(message) => RuntimeDiagnostic {
                component: "sqlite".into(),
                status: "error".into(),
                message,
                remediation: Some(
                    "データフォルダをバックアップし、アプリを再起動してください".into(),
                ),
            },
            Err(error) => RuntimeDiagnostic {
                component: "sqlite".into(),
                status: "error".into(),
                message: error.to_string(),
                remediation: Some("データフォルダの権限と空き容量を確認してください".into()),
            },
        }
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
        if elapsed_seconds < 0 {
            return Err(LyraError::InvalidInput(
                "focus elapsed seconds cannot be negative".into(),
            ));
        }
        let transaction = self.connection.unchecked_transaction()?;
        let ended_at = Utc::now().to_rfc3339();
        let changed = transaction.execute(
            "UPDATE focus_sessions SET status = 'completed', elapsed_seconds = ?2, ended_at = ?3 WHERE id = ?1 AND status = 'running'",
            params![id, elapsed_seconds, ended_at],
        )?;
        if changed == 0 {
            let status = transaction
                .query_row(
                    "SELECT status FROM focus_sessions WHERE id = ?1",
                    [id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            return match status.as_deref() {
                Some("completed") => Ok(()),
                Some(_) => Err(LyraError::InvalidInput(
                    "focus session is not running".into(),
                )),
                None => Err(LyraError::InvalidInput(
                    "focus session was not found".into(),
                )),
            };
        }
        for task_id in completed_task_ids {
            let linked = transaction.execute(
                "UPDATE focus_session_tasks SET completed_at_end = 1 WHERE session_id = ?1 AND task_id = ?2",
                params![id, task_id],
            )?;
            if linked != 1 {
                return Err(LyraError::InvalidInput(format!(
                    "task is not linked to the focus session: {task_id}"
                )));
            }
            let task = transaction
                .query_row(
                    "SELECT id, title, list, completed, estimated_pomodoros, status, priority, project_id, parent_id, notes, planned_date, due_date, position, completed_at, recurrence, recurrence_anchor_day, created_at, updated_at FROM tasks WHERE id = ?1",
                    [task_id],
                    map_task,
                )
                .optional()?
                .ok_or_else(|| LyraError::InvalidInput(format!("task was not found: {task_id}")))?;
            Self::transition_task_completion(&transaction, &task, true, &ended_at)?;
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
        if !matches!(
            input.arrangement.as_str(),
            "ambient" | "lofi" | "minimal-melody" | "organic-pulse" | "downtempo" | "neoclassical"
        ) {
            return Err(LyraError::InvalidInput("invalid music arrangement".into()));
        }
        std::fs::create_dir_all(&input.directory)?;
        let id = Uuid::new_v4().to_string();
        let source_path = input.directory.join(format!("{id}.ck"));
        let pending_path = input.directory.join(format!(".{id}.ck.pending"));
        let write_result = (|| -> std::io::Result<()> {
            let mut pending = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&pending_path)?;
            pending.write_all(input.source.as_bytes())?;
            pending.sync_all()
        })();
        if let Err(error) = write_result {
            let _ = std::fs::remove_file(&pending_path);
            return Err(error.into());
        }
        let source_sha256 = format!("{:x}", Sha256::digest(input.source.as_bytes()));
        let created_at = Utc::now().to_rfc3339();
        let transaction = match self.connection.unchecked_transaction() {
            Ok(transaction) => transaction,
            Err(error) => {
                let cleanup = std::fs::remove_file(&pending_path);
                if let Err(cleanup_error) = cleanup {
                    return Err(LyraError::InvalidInput(format!(
                        "{error}; failed to clean pending music source {}: {cleanup_error}",
                        pending_path.display()
                    )));
                }
                return Err(error.into());
            }
        };
        let result = (|| -> Result<()> {
            transaction.execute(
            "INSERT INTO music_tracks(id, parent_track_id, title, description, theme, arrangement, brightness, density, motion, bpm, tail_seconds, source_path, source_sha256, canonical_seed, recipe_version, recipe_json, structure_family, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                id,
                input.parent_track_id,
                input.title,
                input.description,
                input.theme,
                input.arrangement,
                input.brightness,
                input.density,
                input.motion,
                input.bpm,
                input.tail_seconds,
                source_path.to_string_lossy(),
                source_sha256,
                input.canonical_seed,
                input.recipe_version,
                input.recipe_json,
                input.structure_family,
                created_at,
            ],
            )?;
            std::fs::rename(&pending_path, &source_path)?;
            sync_directory(&input.directory)?;
            transaction.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            let cleanup_errors = [pending_path.as_path(), source_path.as_path()]
                .into_iter()
                .filter_map(|path| match std::fs::remove_file(path) {
                    Ok(()) => None,
                    Err(cleanup_error) if cleanup_error.kind() == std::io::ErrorKind::NotFound => {
                        None
                    }
                    Err(cleanup_error) => Some(format!("{}: {cleanup_error}", path.display())),
                })
                .collect::<Vec<_>>();
            if cleanup_errors.is_empty() {
                return Err(error);
            }
            return Err(LyraError::InvalidInput(format!(
                "{error}; failed to clean pending music source: {}",
                cleanup_errors.join(", ")
            )));
        }
        self.get_music_track(&id)?
            .ok_or_else(|| LyraError::InvalidInput("track was not stored".into()))
    }

    pub fn list_music_tracks(&self) -> Result<Vec<MusicTrackRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, parent_track_id, title, description, theme, arrangement, brightness, density, motion, bpm, tail_seconds, source_path, source_sha256, canonical_seed, rating, favorite, recipe_version, recipe_json, structure_family, created_at FROM music_tracks ORDER BY created_at DESC",
        )?;
        let rows = statement.query_map([], map_music_track)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_music_track(&self, id: &str) -> Result<Option<MusicTrackRecord>> {
        self.connection
            .query_row(
                "SELECT id, parent_track_id, title, description, theme, arrangement, brightness, density, motion, bpm, tail_seconds, source_path, source_sha256, canonical_seed, rating, favorite, recipe_version, recipe_json, structure_family, created_at FROM music_tracks WHERE id = ?1",
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

    pub fn rename_music_track(&self, id: &str, title: &str) -> Result<MusicTrackRecord> {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 100 {
            return Err(LyraError::InvalidInput(
                "music title must contain 1 to 100 characters".into(),
            ));
        }
        let changed = self.connection.execute(
            "UPDATE music_tracks SET title = ?2 WHERE id = ?1",
            params![id, title],
        )?;
        if changed != 1 {
            return Err(LyraError::InvalidInput("music track was not found".into()));
        }
        self.get_music_track(id)?
            .ok_or_else(|| LyraError::InvalidInput("music track was not found".into()))
    }

    pub fn list_music_tracks_filtered(
        &self,
        query: &MusicTrackListQuery,
    ) -> Result<Vec<MusicTrackRecord>> {
        let mut tracks = self.list_music_tracks()?;
        if let Some(search) = query
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let search = search.to_lowercase();
            tracks.retain(|track| {
                track.title.to_lowercase().contains(&search)
                    || track.description.to_lowercase().contains(&search)
            });
        }
        if let Some(favorite) = query.favorite {
            tracks.retain(|track| track.favorite == favorite);
        }
        if let Some(family) = query.structure_family.as_deref() {
            tracks.retain(|track| track.structure_family.as_deref() == Some(family));
        }
        match query.sort {
            MusicTrackSort::CreatedDesc => tracks.sort_by(|a, b| b.created_at.cmp(&a.created_at)),
            MusicTrackSort::CreatedAsc => tracks.sort_by(|a, b| a.created_at.cmp(&b.created_at)),
            MusicTrackSort::TitleAsc => {
                tracks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
            }
            MusicTrackSort::TitleDesc => {
                tracks.sort_by(|a, b| b.title.to_lowercase().cmp(&a.title.to_lowercase()))
            }
            MusicTrackSort::BpmAsc => tracks.sort_by_key(|track| track.bpm),
            MusicTrackSort::BpmDesc => tracks.sort_by_key(|track| std::cmp::Reverse(track.bpm)),
        }
        Ok(tracks)
    }

    pub fn delete_music_tracks(
        &self,
        ids: &[String],
        data_directory: &Path,
    ) -> Result<DeleteMusicTracksResult> {
        self.delete_music_tracks_with_file_ops(ids, data_directory, &mut StandardMusicDeleteFileOps)
    }

    fn delete_music_tracks_with_file_ops(
        &self,
        ids: &[String],
        data_directory: &Path,
        file_ops: &mut impl MusicDeleteFileOps,
    ) -> Result<DeleteMusicTracksResult> {
        let mut seen = HashSet::new();
        let ids = ids
            .iter()
            .filter(|id| seen.insert(id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if ids.is_empty() || ids.len() > 200 {
            return Err(LyraError::InvalidInput(
                "music deletion requires 1 to 200 unique IDs".into(),
            ));
        }
        let data_root = data_directory.canonicalize()?;
        let quarantine_root_path = data_root.join(".delete-quarantine");
        std::fs::create_dir_all(&quarantine_root_path)?;
        let quarantine_root = quarantine_root_path.canonicalize()?;
        if !quarantine_root.starts_with(&data_root) {
            return Err(LyraError::InvalidInput(
                "music quarantine is outside the configured data directory".into(),
            ));
        }
        let quarantine = quarantine_root.join(Uuid::new_v4().to_string());
        std::fs::create_dir_all(&quarantine)?;
        let prepare_journal = (|| -> Result<MusicDeleteJournal> {
            let mut entries = Vec::with_capacity(ids.len());
            for id in &ids {
                let track = self.get_music_track(id)?.ok_or_else(|| {
                    LyraError::InvalidInput(format!("music track was not found: {id}"))
                })?;
                let canonical = PathBuf::from(&track.source_path).canonicalize()?;
                if !canonical.starts_with(&data_root)
                    || canonical.extension().and_then(|value| value.to_str()) != Some("ck")
                {
                    return Err(LyraError::InvalidInput(
                        "music source is outside the configured data directory".into(),
                    ));
                }
                let contents = std::fs::read(&canonical)?;
                let digest = format!("{:x}", Sha256::digest(&contents));
                if digest != track.source_sha256 {
                    return Err(LyraError::InvalidInput(format!(
                        "music source SHA-256 mismatch: {id}"
                    )));
                }
                entries.push(MusicDeleteJournalEntry {
                    id: id.clone(),
                    original_path: canonical,
                    quarantined_path: quarantine.join(format!("{id}.ck")),
                });
            }
            Ok(MusicDeleteJournal { entries })
        })();
        let journal = match prepare_journal {
            Ok(journal) => journal,
            Err(error) => {
                let _ = file_ops.purge(&quarantine);
                return Err(error);
            }
        };
        let journal_json = match serde_json::to_vec_pretty(&journal) {
            Ok(json) => json,
            Err(error) => {
                let _ = file_ops.purge(&quarantine);
                return Err(LyraError::InvalidInput(format!(
                    "music deletion journal could not be encoded: {error}"
                )));
            }
        };
        let journal_path = quarantine.join("journal.json");
        if let Err(error) = (|| -> std::io::Result<()> {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&journal_path)?;
            file.write_all(&journal_json)?;
            file.sync_all()?;
            sync_directory(&quarantine)
        })() {
            let _ = file_ops.purge(&quarantine);
            return Err(error.into());
        }

        let mut moved = Vec::<MusicDeleteJournalEntry>::new();
        let prepare = (|| -> Result<()> {
            for entry in &journal.entries {
                file_ops.rename(&entry.original_path, &entry.quarantined_path)?;
                if let Some(parent) = entry.original_path.parent() {
                    sync_directory(parent)?;
                }
                sync_directory(&quarantine)?;
                moved.push(entry.clone());
            }
            Ok(())
        })();
        if let Err(error) = prepare {
            if let Err(restore_error) = restore_quarantined(&moved, file_ops) {
                return Err(LyraError::InvalidInput(format!(
                    "{error}; quarantined music could not be fully restored and was preserved at {}: {restore_error}",
                    quarantine.display()
                )));
            }
            let _ = file_ops.purge(&quarantine);
            return Err(error);
        }

        let database_result = (|| -> Result<DeleteMusicTracksResult> {
            let transaction = self.connection.unchecked_transaction()?;
            let placeholders = std::iter::repeat_n("?", ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let mut children_statement = transaction.prepare(&format!(
                "SELECT id FROM music_tracks WHERE parent_track_id IN ({placeholders}) AND id NOT IN ({placeholders}) ORDER BY id"
            ))?;
            let values = ids
                .iter()
                .chain(ids.iter())
                .map(String::as_str)
                .collect::<Vec<_>>();
            let unlinked_child_ids = children_statement
                .query_map(rusqlite::params_from_iter(values), |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(children_statement);
            transaction.execute(&format!("UPDATE music_tracks SET parent_track_id = NULL WHERE parent_track_id IN ({placeholders})"), rusqlite::params_from_iter(ids.iter()))?;
            let deleted = transaction.execute(
                &format!("DELETE FROM music_tracks WHERE id IN ({placeholders})"),
                rusqlite::params_from_iter(ids.iter()),
            )?;
            if deleted != ids.len() {
                return Err(LyraError::InvalidInput(
                    "one or more music tracks disappeared during deletion".into(),
                ));
            }
            transaction.commit()?;
            Ok(DeleteMusicTracksResult {
                deleted_ids: ids.clone(),
                unlinked_child_ids,
            })
        })();
        match database_result {
            Ok(result) => {
                // The database is now authoritative. A purge failure is cleanup debt, not a
                // failed delete; the durable journal is recovered on the next launch.
                let _ = file_ops.purge(&quarantine);
                Ok(result)
            }
            Err(error) => {
                if let Err(restore_error) = restore_quarantined(&moved, file_ops) {
                    return Err(LyraError::InvalidInput(format!(
                        "{error}; quarantined music could not be fully restored and was preserved at {}: {restore_error}",
                        quarantine.display()
                    )));
                }
                let _ = file_ops.purge(&quarantine);
                Err(error)
            }
        }
    }

    pub fn recover_music_delete_quarantine(&self, data_directory: &Path) -> Result<usize> {
        let data_root = data_directory.canonicalize()?;
        let quarantine_root_path = data_root.join(".delete-quarantine");
        let quarantine_root = match quarantine_root_path.canonicalize() {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(error.into()),
        };
        if !quarantine_root.starts_with(&data_root) {
            return Err(LyraError::InvalidInput(
                "music quarantine is outside the configured data directory".into(),
            ));
        }
        let Ok(directories) = std::fs::read_dir(&quarantine_root) else {
            return Ok(0);
        };
        let mut recovered = 0;
        for entry in directories {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let directory = entry.path().canonicalize()?;
            if !directory.starts_with(&quarantine_root) {
                return Err(LyraError::InvalidInput(format!(
                    "music deletion directory is outside quarantine at {}",
                    directory.display()
                )));
            }
            let journal_path = directory.join("journal.json");
            let Ok(contents) = std::fs::read(&journal_path) else {
                let _ = std::fs::remove_dir_all(&directory);
                continue;
            };
            let Ok(journal) = serde_json::from_slice::<MusicDeleteJournal>(&contents) else {
                // Preserve malformed journals for manual inspection without blocking recovery
                // of other deletion operations or application startup.
                continue;
            };
            for entry in &journal.entries {
                if !path_parent_is_within(&entry.original_path, &data_root)
                    || entry
                        .original_path
                        .extension()
                        .and_then(|value| value.to_str())
                        != Some("ck")
                    || !path_parent_is_within(&entry.quarantined_path, &directory)
                {
                    return Err(LyraError::InvalidInput(format!(
                        "music deletion journal contains an unsafe path at {}",
                        directory.display()
                    )));
                }
            }
            let database_rows_remain = journal.entries.iter().try_fold(false, |found, entry| {
                Ok::<_, LyraError>(found || self.get_music_track(&entry.id)?.is_some())
            })?;
            if database_rows_remain {
                restore_quarantined(&journal.entries, &mut StandardMusicDeleteFileOps)?;
            }
            std::fs::remove_dir_all(&directory)?;
            recovered += 1;
        }
        let _ = std::fs::remove_dir(&quarantine_root);
        Ok(recovered)
    }
}

fn path_parent_is_within(path: &Path, root: &Path) -> bool {
    path.parent()
        .and_then(|parent| parent.canonicalize().ok())
        .is_some_and(|parent| parent.starts_with(root))
}

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let list: String = row.get(2)?;
    let list = TaskList::parse(&list).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let status: String = row.get(5)?;
    let priority: String = row.get(6)?;
    let recurrence: Option<String> = row.get(14)?;
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        list,
        completed: row.get(3)?,
        estimated_pomodoros: row.get(4)?,
        status: TaskStatus::parse(&status).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        priority: TaskPriority::parse(&priority).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        project_id: row.get(7)?,
        parent_id: row.get(8)?,
        notes: row.get(9)?,
        planned_date: row.get(10)?,
        due_date: row.get(11)?,
        position: row.get(12)?,
        completed_at: row.get(13)?,
        recurrence: recurrence
            .map(|value| Recurrence::parse(&value))
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    14,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?,
        tags: Vec::new(),
        recurrence_anchor_day: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn map_music_track(row: &rusqlite::Row<'_>) -> rusqlite::Result<MusicTrackRecord> {
    Ok(MusicTrackRecord {
        id: row.get(0)?,
        parent_track_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        theme: row.get(4)?,
        arrangement: row.get(5)?,
        brightness: row.get(6)?,
        density: row.get(7)?,
        motion: row.get(8)?,
        bpm: row.get(9)?,
        tail_seconds: row.get(10)?,
        source_path: row.get(11)?,
        source_sha256: row.get(12)?,
        canonical_seed: row.get(13)?,
        rating: row.get(14)?,
        favorite: row.get(15)?,
        recipe_version: row.get(16)?,
        recipe_json: row.get(17)?,
        structure_family: row.get(18)?,
        created_at: row.get(19)?,
    })
}

fn validate_task_title(title: &str) -> Result<()> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(LyraError::InvalidInput(
            "task title must contain 1 to 200 characters".into(),
        ));
    }
    Ok(())
}

fn validate_estimate(estimate: Option<i64>) -> Result<()> {
    if estimate.is_some_and(|value| !(1..=99).contains(&value)) {
        return Err(LyraError::InvalidInput(
            "estimated pomodoros must be between 1 and 99".into(),
        ));
    }
    Ok(())
}

fn validate_task_dates(planned: Option<&str>, due: Option<&str>) -> Result<()> {
    for value in [planned, due].into_iter().flatten() {
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| LyraError::InvalidInput("task dates must use YYYY-MM-DD".into()))?;
    }
    Ok(())
}

fn recurrence_base_date(task: &Task) -> Result<&str> {
    task.planned_date
        .as_deref()
        .or(task.due_date.as_deref())
        .ok_or_else(|| {
            LyraError::InvalidInput("recurring task requires a planned or due date".into())
        })
}

fn recurrence_anchor_day(
    recurrence: Option<Recurrence>,
    planned: Option<&str>,
    due: Option<&str>,
) -> Result<Option<u32>> {
    if recurrence != Some(Recurrence::Monthly) {
        return Ok(None);
    }
    let value = planned.or(due).ok_or_else(|| {
        LyraError::InvalidInput("recurring task requires a planned or due date".into())
    })?;
    Ok(Some(
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map_err(|_| LyraError::InvalidInput("task dates must use YYYY-MM-DD".into()))?
            .day(),
    ))
}

fn restore_quarantined(
    moved: &[MusicDeleteJournalEntry],
    file_ops: &mut impl MusicDeleteFileOps,
) -> Result<()> {
    let mut failures = Vec::new();
    for entry in moved.iter().rev() {
        if entry.quarantined_path.exists() {
            if entry.original_path.exists() {
                failures.push(format!("{} already exists", entry.original_path.display()));
                continue;
            }
            if let Err(error) = file_ops.rename(&entry.quarantined_path, &entry.original_path) {
                failures.push(format!(
                    "{} -> {}: {error}",
                    entry.quarantined_path.display(),
                    entry.original_path.display()
                ));
            }
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(LyraError::InvalidInput(failures.join("; ")))
    }
}

pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}

#[cfg(test)]
mod music_delete_failure_tests {
    use super::*;

    struct FaultyFileOps {
        rename_calls: usize,
        fail_rename_calls: HashSet<usize>,
        fail_purge: bool,
    }

    impl MusicDeleteFileOps for FaultyFileOps {
        fn rename(&mut self, from: &Path, to: &Path) -> std::io::Result<()> {
            self.rename_calls += 1;
            if self.fail_rename_calls.contains(&self.rename_calls) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("injected rename failure {}", self.rename_calls),
                ));
            }
            std::fs::rename(from, to)
        }

        fn purge(&mut self, directory: &Path) -> std::io::Result<()> {
            if self.fail_purge {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "injected purge failure",
                ));
            }
            std::fs::remove_dir_all(directory)
        }
    }

    fn track(directory: &Path, title: &str) -> NewMusicTrack {
        NewMusicTrack {
            parent_track_id: None,
            title: title.into(),
            description: "test".into(),
            theme: "deep-space".into(),
            arrangement: "ambient".into(),
            brightness: "medium".into(),
            density: "medium".into(),
            motion: "low".into(),
            bpm: 64,
            tail_seconds: 4,
            source: "SinOsc s => dac; 1::second => now;".into(),
            canonical_seed: 1,
            directory: directory.into(),
            recipe_version: None,
            recipe_json: None,
            structure_family: None,
        }
    }

    #[test]
    fn partial_prepare_failure_restores_every_moved_source() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let first = db.save_music_track(track(temp.path(), "first")).unwrap();
        let second = db.save_music_track(track(temp.path(), "second")).unwrap();
        let mut file_ops = FaultyFileOps {
            rename_calls: 0,
            fail_rename_calls: HashSet::from([2]),
            fail_purge: false,
        };

        assert!(db
            .delete_music_tracks_with_file_ops(
                &[first.id.clone(), second.id.clone()],
                temp.path(),
                &mut file_ops,
            )
            .is_err());
        assert!(Path::new(&first.source_path).exists());
        assert!(Path::new(&second.source_path).exists());
        assert!(db.get_music_track(&first.id).unwrap().is_some());
        assert!(db.get_music_track(&second.id).unwrap().is_some());
    }

    #[test]
    fn restore_failure_preserves_the_only_source_in_quarantine() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let first = db.save_music_track(track(temp.path(), "first")).unwrap();
        let second = db.save_music_track(track(temp.path(), "second")).unwrap();
        let mut file_ops = FaultyFileOps {
            rename_calls: 0,
            fail_rename_calls: HashSet::from([2, 3]),
            fail_purge: false,
        };

        let error = db
            .delete_music_tracks_with_file_ops(
                &[first.id.clone(), second.id.clone()],
                temp.path(),
                &mut file_ops,
            )
            .unwrap_err()
            .to_string();
        assert!(error.contains("preserved at"));
        assert!(!Path::new(&first.source_path).exists());
        assert!(Path::new(&second.source_path).exists());
        let quarantined = std::fs::read_dir(temp.path().join(".delete-quarantine"))
            .unwrap()
            .flat_map(|entry| std::fs::read_dir(entry.unwrap().path()).unwrap())
            .map(|entry| entry.unwrap().path())
            .any(|path| path.extension().and_then(|value| value.to_str()) == Some("ck"));
        assert!(quarantined, "the sole source copy must remain quarantined");
        assert_eq!(db.recover_music_delete_quarantine(temp.path()).unwrap(), 1);
        assert!(Path::new(&first.source_path).exists());
    }

    #[test]
    fn purge_failure_after_commit_is_success_and_is_recovered_later() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let stored = db.save_music_track(track(temp.path(), "track")).unwrap();
        let mut file_ops = FaultyFileOps {
            rename_calls: 0,
            fail_rename_calls: HashSet::new(),
            fail_purge: true,
        };

        let result = db
            .delete_music_tracks_with_file_ops(&[stored.id.clone()], temp.path(), &mut file_ops)
            .unwrap();
        assert_eq!(result.deleted_ids, vec![stored.id]);
        assert!(temp.path().join(".delete-quarantine").exists());

        assert_eq!(db.recover_music_delete_quarantine(temp.path()).unwrap(), 1);
        assert!(!temp.path().join(".delete-quarantine").exists());
    }
}
