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
        brightness: "medium".into(),
        density: "medium".into(),
        motion: "low".into(),
        bpm: 64,
        tail_seconds: 4,
        source: "(~lyraTrack = (synthDefs: [], pattern: Pseq([1], inf));)".into(),
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
