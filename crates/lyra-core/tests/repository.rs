use lyra_core::{
    AddTask, Database, FocusSessionStatus, MusicTrackRecord, NewMusicTrack, TaskList, TimerPreset,
};
use std::path::Path;

fn track_fixture(directory: &Path, parent_track_id: Option<String>, seed: i64) -> NewMusicTrack {
    NewMusicTrack {
        parent_track_id,
        title: format!("Track {seed}"),
        description: "A generated focus track".into(),
        theme: "deep-space".into(),
        arrangement: "minimal-melody".into(),
        brightness: "medium".into(),
        density: "medium".into(),
        motion: "low".into(),
        bpm: 64,
        tail_seconds: 4,
        source: "Math.srandom(__LYRA_SEED__); SinOsc osc => dac; while(true) { 1::second => now; }"
            .into(),
        canonical_seed: seed,
        directory: directory.to_path_buf(),
    }
}

#[test]
fn migrates_and_seeds_builtin_presets() {
    let db = Database::open_in_memory().unwrap();
    let presets = db.list_timer_presets().unwrap();

    assert_eq!(presets.len(), 3);
    assert_eq!(presets[0].name, "Sprint");
    assert_eq!(presets[1].focus_minutes, 25);
    assert_eq!(presets[2].short_break_minutes, 10);
}

#[test]
fn stores_a_versioned_setting() {
    let db = Database::open_in_memory().unwrap();
    assert_eq!(db.get_setting("ui.theme.v1").unwrap(), None);

    db.set_setting("ui.theme.v1", r#"{"mode":"dark"}"#).unwrap();

    assert_eq!(
        db.get_setting("ui.theme.v1").unwrap().as_deref(),
        Some(r#"{"mode":"dark"}"#)
    );
}

#[test]
fn migration_v3_deletes_legacy_tracks_and_unlinks_focus_history() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("v1.db");
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE schema_migrations (
                  version INTEGER PRIMARY KEY,
                  applied_at TEXT NOT NULL
                );
                INSERT INTO schema_migrations VALUES(1, '2026-07-15T00:00:00Z');
                CREATE TABLE music_tracks (
                  id TEXT PRIMARY KEY,
                  parent_track_id TEXT REFERENCES music_tracks(id),
                  title TEXT NOT NULL,
                  description TEXT NOT NULL,
                  theme TEXT NOT NULL,
                  brightness TEXT NOT NULL,
                  density TEXT NOT NULL,
                  motion TEXT NOT NULL,
                  bpm INTEGER NOT NULL,
                  tail_seconds INTEGER NOT NULL,
                  source_path TEXT NOT NULL UNIQUE,
                  source_sha256 TEXT NOT NULL,
                  canonical_seed INTEGER NOT NULL,
                  rating TEXT,
                  favorite INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL
                );
                INSERT INTO music_tracks VALUES(
                  'legacy-track', NULL, 'Legacy', 'Existing track', 'deep-space',
                  'medium', 'medium', 'low', 64, 4, '/tmp/legacy.scd', 'hash', 42,
                  NULL, 0, '2026-07-15T00:00:00Z'
                );
                CREATE TABLE focus_sessions (
                  id TEXT PRIMARY KEY,
                  preset_id TEXT NOT NULL,
                  music_track_id TEXT,
                  status TEXT NOT NULL,
                  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
                  started_at TEXT NOT NULL,
                  ended_at TEXT
                );
                INSERT INTO focus_sessions VALUES(
                  'focus-1', 'standard', 'legacy-track', 'completed', 1500,
                  '2026-07-15T00:00:00Z', '2026-07-15T00:25:00Z'
                );
                "#,
            )
            .unwrap();
    }

    let database = Database::open(&path).unwrap();
    assert!(database.get_music_track("legacy-track").unwrap().is_none());
    let session = database.get_focus_session("focus-1").unwrap().unwrap();
    assert_eq!(session.music_track_id, None);
}

#[test]
fn rolls_back_v2_schema_change_when_migration_version_cannot_be_recorded() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("failed-v2.db");
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE schema_migrations (
                  version INTEGER PRIMARY KEY,
                  applied_at TEXT NOT NULL
                );
                INSERT INTO schema_migrations VALUES(1, '2026-07-15T00:00:00Z');
                CREATE TABLE music_tracks (
                  id TEXT PRIMARY KEY,
                  parent_track_id TEXT REFERENCES music_tracks(id),
                  title TEXT NOT NULL,
                  description TEXT NOT NULL,
                  theme TEXT NOT NULL,
                  brightness TEXT NOT NULL,
                  density TEXT NOT NULL,
                  motion TEXT NOT NULL,
                  bpm INTEGER NOT NULL,
                  tail_seconds INTEGER NOT NULL,
                  source_path TEXT NOT NULL UNIQUE,
                  source_sha256 TEXT NOT NULL,
                  canonical_seed INTEGER NOT NULL,
                  rating TEXT,
                  favorite INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL
                );
                CREATE TRIGGER reject_v2
                BEFORE INSERT ON schema_migrations
                WHEN NEW.version = 2
                BEGIN
                  SELECT RAISE(ABORT, 'reject v2');
                END;
                "#,
            )
            .unwrap();
    }

    assert!(Database::open(&path).is_err());

    let connection = rusqlite::Connection::open(&path).unwrap();
    let arrangement_columns: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('music_tracks') WHERE name = 'arrangement'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(arrangement_columns, 0);
}

#[test]
fn adds_and_updates_tasks_in_today_and_backlog() {
    let db = Database::open_in_memory().unwrap();
    let today = db
        .add_task(AddTask {
            title: "Build timer".into(),
            list: TaskList::Today,
            estimated_pomodoros: Some(2),
        })
        .unwrap();
    let backlog = db
        .add_task(AddTask {
            title: "Polish sounds".into(),
            list: TaskList::Backlog,
            estimated_pomodoros: None,
        })
        .unwrap();

    db.set_task_completed(&today.id, true).unwrap();
    db.move_task(&backlog.id, TaskList::Today).unwrap();

    let tasks = db.list_tasks(None).unwrap();
    assert_eq!(tasks.len(), 2);
    assert!(
        tasks
            .iter()
            .find(|task| task.id == today.id)
            .unwrap()
            .completed
    );
    assert_eq!(
        db.get_task(&backlog.id).unwrap().unwrap().list,
        TaskList::Today
    );
}

#[test]
fn completes_one_focus_session_linked_to_multiple_tasks() {
    let db = Database::open_in_memory().unwrap();
    let first = db
        .add_task(AddTask {
            title: "First".into(),
            list: TaskList::Today,
            estimated_pomodoros: None,
        })
        .unwrap();
    let second = db
        .add_task(AddTask {
            title: "Second".into(),
            list: TaskList::Today,
            estimated_pomodoros: None,
        })
        .unwrap();

    let session = db
        .start_focus_session(&[first.id.clone(), second.id.clone()], "standard", None)
        .unwrap();
    db.complete_focus_session(&session.id, 1_500, &[second.id.clone()])
        .unwrap();

    let stored = db.get_focus_session(&session.id).unwrap().unwrap();
    assert_eq!(stored.status, FocusSessionStatus::Completed);
    assert_eq!(stored.elapsed_seconds, 1_500);
    assert_eq!(db.completed_focus_count().unwrap(), 1);
    assert!(!db.get_task(&first.id).unwrap().unwrap().completed);
    assert!(db.get_task(&second.id).unwrap().unwrap().completed);
}

#[test]
fn interrupted_sessions_do_not_increment_completion_count() {
    let db = Database::open_in_memory().unwrap();
    let session = db.start_focus_session(&[], "sprint", None).unwrap();
    db.interrupt_running_sessions().unwrap();

    let stored = db.get_focus_session(&session.id).unwrap().unwrap();
    assert_eq!(stored.status, FocusSessionStatus::Interrupted);
    assert_eq!(db.completed_focus_count().unwrap(), 0);
}

#[test]
fn opening_the_database_for_mcp_does_not_interrupt_desktop_focus() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("lyra.db");
    let session_id = {
        let db = Database::open(&path).unwrap();
        db.start_focus_session(&[], "sprint", None).unwrap().id
    };

    let db = Database::open(&path).unwrap();
    let running = db.get_focus_session(&session_id).unwrap().unwrap();
    assert_eq!(running.status, FocusSessionStatus::Running);

    db.interrupt_running_sessions().unwrap();
    let interrupted = db.get_focus_session(&session_id).unwrap().unwrap();
    assert_eq!(interrupted.status, FocusSessionStatus::Interrupted);
}

#[test]
fn saves_variation_as_a_child_track() {
    let directory = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let parent = db
        .save_music_track(track_fixture(directory.path(), None, 42))
        .unwrap();
    let child = db
        .save_music_track(track_fixture(directory.path(), Some(parent.id.clone()), 84))
        .unwrap();

    let tracks: Vec<MusicTrackRecord> = db.list_music_tracks().unwrap();
    assert_eq!(tracks.len(), 2);
    assert_eq!(child.parent_track_id.as_deref(), Some(parent.id.as_str()));
    assert_eq!(child.canonical_seed, 84);
    assert_eq!(parent.arrangement, "minimal-melody");
    assert_eq!(child.arrangement, "minimal-melody");
    assert!(parent.source_path.ends_with(".ck"));
}

#[test]
fn saves_a_custom_timer_preset_without_mutating_builtins() {
    let db = Database::open_in_memory().unwrap();
    db.save_timer_preset(TimerPreset {
        id: "custom-1".into(),
        name: "Flow 40".into(),
        focus_minutes: 40,
        short_break_minutes: 8,
        long_break_minutes: 18,
        cycles_before_long_break: 3,
        built_in: false,
    })
    .unwrap();

    let presets = db.list_timer_presets().unwrap();
    assert_eq!(presets.len(), 4);
    assert_eq!(
        presets
            .iter()
            .find(|preset| preset.id == "custom-1")
            .unwrap()
            .focus_minutes,
        40
    );
    assert!(db
        .save_timer_preset(TimerPreset {
            id: "standard".into(),
            name: "Changed".into(),
            focus_minutes: 1,
            short_break_minutes: 1,
            long_break_minutes: 1,
            cycles_before_long_break: 1,
            built_in: false,
        })
        .is_err());
}
