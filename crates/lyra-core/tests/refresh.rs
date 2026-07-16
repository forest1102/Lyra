use lyra_core::{
    AddTaskV2, AppSettingsV2, Database, DeleteMusicTracksResult, MoodSelection, MusicRecipeV1,
    MusicTrackListQuery, MusicTrackSort, NewMusicTrack, Project, Recurrence, Tag, TaskPriority,
    TaskStatus, TimerPreset, UpdateTask,
};
use std::path::Path;

fn track(directory: &Path, parent_track_id: Option<String>, title: &str) -> NewMusicTrack {
    NewMusicTrack {
        parent_track_id,
        title: title.into(),
        description: "focus music".into(),
        theme: "deep-space".into(),
        arrangement: "ambient".into(),
        brightness: "medium".into(),
        density: "medium".into(),
        motion: "low".into(),
        bpm: 64,
        tail_seconds: 4,
        source: "Math.srandom(__LYRA_SEED__); SinOsc s => dac; while(true) { 1::second => now; }"
            .into(),
        canonical_seed: 42,
        directory: directory.to_path_buf(),
        recipe_version: Some(1),
        recipe_json: Some(
            r#"{"version":1,"moods":[{"moodId":"scene-rainy-window","weight":1.0}]}"#.into(),
        ),
        structure_family: Some("ambient".into()),
    }
}

#[test]
fn migration_v4_preserves_legacy_tasks_and_maps_today_to_active() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("v3.db");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            r#"
            CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            INSERT INTO schema_migrations VALUES(3, '2026-07-15T00:00:00Z');
            CREATE TABLE tasks (
              id TEXT PRIMARY KEY, title TEXT NOT NULL, list TEXT NOT NULL,
              completed INTEGER NOT NULL DEFAULT 0, estimated_pomodoros INTEGER,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            INSERT INTO tasks VALUES('today', 'Today task', 'today', 0, 2, '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z');
            INSERT INTO tasks VALUES('done', 'Done task', 'backlog', 1, NULL, '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z');
            CREATE TABLE music_tracks (
              id TEXT PRIMARY KEY, parent_track_id TEXT REFERENCES music_tracks(id), title TEXT NOT NULL,
              description TEXT NOT NULL, theme TEXT NOT NULL, brightness TEXT NOT NULL,
              density TEXT NOT NULL, motion TEXT NOT NULL, bpm INTEGER NOT NULL, tail_seconds INTEGER NOT NULL,
              source_path TEXT NOT NULL UNIQUE, source_sha256 TEXT NOT NULL, canonical_seed INTEGER NOT NULL,
              rating TEXT, favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
              arrangement TEXT NOT NULL DEFAULT 'ambient'
            );
            INSERT INTO music_tracks VALUES(
              'chuck-v3', NULL, 'Existing ChucK', 'Legacy recipe source', 'rainy-cabin',
              'medium', 'low', 'low', 64, 4, '/tmp/chuck-v3.ck', 'hash', 42,
              NULL, 0, '2026-07-15T00:00:00Z', 'ambient'
            );
            INSERT INTO music_tracks VALUES(
              'child-v3', 'chuck-v3', 'Child ChucK', 'Legacy child', 'rainy-cabin',
              'medium', 'low', 'low', 64, 4, '/tmp/child-v3.ck', 'child-hash', 43,
              NULL, 0, '2026-07-15T00:00:01Z', 'ambient'
            );
            CREATE TABLE focus_sessions (
              id TEXT PRIMARY KEY, preset_id TEXT NOT NULL,
              music_track_id TEXT REFERENCES music_tracks(id),
              status TEXT NOT NULL, elapsed_seconds INTEGER NOT NULL DEFAULT 0,
              started_at TEXT NOT NULL, ended_at TEXT
            );
            INSERT INTO focus_sessions VALUES(
              'focus-v3', 'standard', 'chuck-v3', 'completed', 1500,
              '2026-07-15T00:00:00Z', '2026-07-15T00:25:00Z'
            );
            CREATE TABLE focus_session_tasks (
              session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
              task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
              completed_at_end INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(session_id, task_id)
            );
            INSERT INTO focus_session_tasks VALUES('focus-v3', 'today', 0);
            CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO settings VALUES('preserved', 'yes');
            "#,
        )
        .unwrap();
    drop(connection);

    let db = Database::open(&path).unwrap();
    let today = db.get_task("today").unwrap().unwrap();
    let done = db.get_task("done").unwrap().unwrap();

    assert_eq!(today.status, TaskStatus::Active);
    assert!(today.planned_date.is_some());
    assert_eq!(done.status, TaskStatus::Completed);
    assert_eq!(done.priority, TaskPriority::None);
    let legacy = db.get_music_track("chuck-v3").unwrap().unwrap();
    assert_eq!(legacy.recipe_version, Some(0));
    assert!(legacy.recipe_json.unwrap().contains("legacy"));
    assert_eq!(legacy.structure_family.as_deref(), Some("ambient"));
    assert_eq!(
        db.get_music_track("child-v3")
            .unwrap()
            .unwrap()
            .parent_track_id
            .as_deref(),
        Some("chuck-v3")
    );
    assert_eq!(
        db.get_focus_session("focus-v3")
            .unwrap()
            .unwrap()
            .music_track_id
            .as_deref(),
        Some("chuck-v3")
    );
    assert_eq!(db.get_setting("preserved").unwrap().as_deref(), Some("yes"));
    drop(db);

    let connection = rusqlite::Connection::open(&path).unwrap();
    let focus_track_parent: String = connection
        .query_row(
            "SELECT \"table\" FROM pragma_foreign_key_list('focus_sessions') WHERE \"from\" = 'music_track_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let focus_task_parent: String = connection
        .query_row(
            "SELECT \"table\" FROM pragma_foreign_key_list('focus_session_tasks') WHERE \"from\" = 'session_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let foreign_key_errors: i64 = connection
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .unwrap();
    let linked_tasks: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM focus_session_tasks WHERE session_id = 'focus-v3' AND task_id = 'today'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(focus_track_parent, "music_tracks");
    assert_eq!(focus_task_parent, "focus_sessions");
    assert_eq!(foreign_key_errors, 0);
    assert_eq!(linked_tasks, 1);
    drop(connection);

    let reopened = Database::open(&path).unwrap();
    assert_eq!(
        reopened.get_task("today").unwrap().unwrap().status,
        TaskStatus::Active
    );
    assert_eq!(
        reopened
            .get_music_track("child-v3")
            .unwrap()
            .unwrap()
            .parent_track_id
            .as_deref(),
        Some("chuck-v3")
    );
}

#[test]
fn monthly_recurrence_clamps_to_the_end_of_the_next_month() {
    assert_eq!(
        Recurrence::Monthly.next_date("2026-01-31").unwrap(),
        "2026-02-28"
    );
    assert_eq!(
        Recurrence::Monthly.next_date("2028-01-31").unwrap(),
        "2028-02-29"
    );
}

#[test]
fn recipe_rejects_duplicates_and_resolves_known_moods() {
    let duplicate = MusicRecipeV1 {
        version: 1,
        moods: vec![
            MoodSelection {
                mood_id: "scene-rainy-window".into(),
                weight: 0.5,
            },
            MoodSelection {
                mood_id: "scene-rainy-window".into(),
                weight: 0.5,
            },
        ],
    };
    assert!(duplicate.resolve().is_err());

    let resolved = MusicRecipeV1 {
        version: 1,
        moods: vec![MoodSelection {
            mood_id: "scene-rainy-window".into(),
            weight: 1.0,
        }],
    }
    .resolve()
    .unwrap();
    assert_eq!(resolved.recipe.version, 1);
    assert!((resolved.vectors.space - 0.9).abs() < 0.001);
    assert!(matches!(
        resolved.structure_family.as_str(),
        "ambient" | "lofi" | "minimal-melody" | "organic-pulse" | "downtempo" | "neoclassical"
    ));
}

#[test]
fn rename_only_changes_the_database_title_and_filtered_list_matches() {
    let temp = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let stored = db
        .save_music_track(track(temp.path(), None, "Old title"))
        .unwrap();
    let original_hash = stored.source_sha256.clone();
    let original_path = stored.source_path.clone();

    let renamed = db.rename_music_track(&stored.id, "  New title  ").unwrap();
    assert_eq!(renamed.title, "New title");
    assert_eq!(renamed.source_sha256, original_hash);
    assert_eq!(renamed.source_path, original_path);
    assert!(db.rename_music_track(&stored.id, "   ").is_err());

    let listed = db
        .list_music_tracks_filtered(&MusicTrackListQuery {
            query: Some("new TITLE".into()),
            favorite: None,
            structure_family: None,
            sort: MusicTrackSort::TitleAsc,
        })
        .unwrap();
    assert_eq!(listed.len(), 1);
}

#[test]
fn bulk_delete_deduplicates_and_unlinks_surviving_children() {
    let temp = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let parent = db
        .save_music_track(track(temp.path(), None, "Parent"))
        .unwrap();
    let child = db
        .save_music_track(track(temp.path(), Some(parent.id.clone()), "Child"))
        .unwrap();

    let result: DeleteMusicTracksResult = db
        .delete_music_tracks(&[parent.id.clone(), parent.id.clone()], temp.path())
        .unwrap();

    assert_eq!(result.deleted_ids, vec![parent.id.clone()]);
    assert_eq!(result.unlinked_child_ids, vec![child.id.clone()]);
    assert!(db.get_music_track(&parent.id).unwrap().is_none());
    assert_eq!(
        db.get_music_track(&child.id)
            .unwrap()
            .unwrap()
            .parent_track_id,
        None
    );
    assert!(!Path::new(&parent.source_path).exists());
}

#[test]
fn bulk_delete_rejects_tampered_files_and_more_than_two_hundred_ids() {
    let temp = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let stored = db
        .save_music_track(track(temp.path(), None, "Track"))
        .unwrap();
    std::fs::write(&stored.source_path, "tampered").unwrap();
    assert!(db
        .delete_music_tracks(&[stored.id.clone()], temp.path())
        .is_err());
    assert!(db.get_music_track(&stored.id).unwrap().is_some());

    let ids = (0..201)
        .map(|index| format!("id-{index}"))
        .collect::<Vec<_>>();
    assert!(db.delete_music_tracks(&ids, temp.path()).is_err());
}

#[test]
fn settings_defaults_are_versioned_and_builtin_presets_cannot_be_deleted() {
    let db = Database::open_in_memory().unwrap();
    assert_eq!(db.get_app_settings().unwrap(), AppSettingsV2::default());
    assert_eq!(db.get_app_settings().unwrap().version, 2);
    assert_eq!(db.get_app_settings().unwrap().master_volume, 1.5);
    assert!(db.get_setting("app.settings.v2").unwrap().is_some());
    assert_eq!(db.get_app_settings().unwrap().crossfade_seconds, 2.0);
    let invalid = AppSettingsV2 {
        launch_at_login: true,
        default_preset_id: "missing".into(),
        ..AppSettingsV2::default()
    };
    assert!(db.save_app_settings(&invalid).is_err());
    assert_eq!(db.get_app_settings().unwrap(), AppSettingsV2::default());
    assert!(db.delete_timer_preset("standard").is_err());

    db.save_timer_preset(TimerPreset {
        id: "custom-default".into(),
        name: "Custom".into(),
        focus_minutes: 30,
        short_break_minutes: 5,
        long_break_minutes: 15,
        cycles_before_long_break: 4,
        built_in: false,
    })
    .unwrap();
    db.save_app_settings(&AppSettingsV2 {
        default_preset_id: "custom-default".into(),
        ..AppSettingsV2::default()
    })
    .unwrap();
    assert!(db.delete_timer_preset("custom-default").is_err());
}

#[test]
fn settings_migrate_legacy_volume_once_and_preserve_lower_values() {
    let db = Database::open_in_memory().unwrap();
    db.set_setting(
        "app.settings.v1",
        r#"{"version":1,"closeBehavior":"hide","launchAtLogin":false,"defaultPresetId":"standard","autoStartBreak":false,"notificationsEnabled":true,"masterVolume":1.0,"playSelectedTrackOnFocus":true,"crossfadeSeconds":2.0}"#,
    )
    .unwrap();

    let migrated = db.get_app_settings().unwrap();
    assert_eq!(migrated.master_volume, 1.5);
    assert!(db.get_setting("app.settings.v2").unwrap().is_some());

    db.save_app_settings(&AppSettingsV2 {
        master_volume: 1.0,
        ..migrated
    })
    .unwrap();
    assert_eq!(db.get_app_settings().unwrap().master_volume, 1.0);

    let lower = Database::open_in_memory().unwrap();
    lower
        .set_setting(
            "app.settings.v1",
            r#"{"version":1,"closeBehavior":"hide","launchAtLogin":false,"defaultPresetId":"standard","autoStartBreak":false,"notificationsEnabled":true,"masterVolume":0.65,"playSelectedTrackOnFocus":true,"crossfadeSeconds":2.0}"#,
        )
        .unwrap();
    assert_eq!(lower.get_app_settings().unwrap().master_volume, 0.65);
}

#[test]
fn settings_accept_master_volume_through_two() {
    let db = Database::open_in_memory().unwrap();
    assert!(db
        .save_app_settings(&AppSettingsV2 {
            master_volume: 2.0,
            ..AppSettingsV2::default()
        })
        .is_ok());
    assert!(db
        .save_app_settings(&AppSettingsV2 {
            master_volume: 2.01,
            ..AppSettingsV2::default()
        })
        .is_err());
}

#[test]
fn projects_tags_and_one_level_subtasks_are_validated() {
    let db = Database::open_in_memory().unwrap();
    db.save_project(Project {
        id: "project-1".into(),
        name: "Lyra".into(),
        color: Some("lime".into()),
        position: 0,
    })
    .unwrap();
    db.save_tag(Tag {
        id: "tag-1".into(),
        name: "Design".into(),
    })
    .unwrap();
    let root = db
        .add_task_v2(AddTaskV2 {
            title: "Root".into(),
            status: TaskStatus::Active,
            priority: TaskPriority::High,
            estimated_pomodoros: Some(2),
            project_id: Some("project-1".into()),
            parent_id: None,
            notes: String::new(),
            planned_date: Some("2026-07-15".into()),
            due_date: None,
            recurrence: None,
            tag_ids: vec!["tag-1".into()],
        })
        .unwrap();
    let child = db
        .add_task_v2(AddTaskV2 {
            title: "Child".into(),
            status: TaskStatus::Inbox,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: Some(root.id.clone()),
            notes: String::new(),
            planned_date: None,
            due_date: None,
            recurrence: None,
            tag_ids: vec![],
        })
        .unwrap();
    assert_eq!(root.tags[0].name, "Design");
    assert_eq!(db.list_projects().unwrap().len(), 1);
    assert_eq!(db.list_tags().unwrap().len(), 1);

    assert!(db
        .add_task_v2(AddTaskV2 {
            title: "Grandchild".into(),
            status: TaskStatus::Inbox,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: Some(child.id),
            notes: String::new(),
            planned_date: None,
            due_date: None,
            recurrence: None,
            tag_ids: vec![],
        })
        .is_err());

    let recurring_root = db
        .add_task_v2(AddTaskV2 {
            title: "Recurring root".into(),
            status: TaskStatus::Active,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: None,
            notes: String::new(),
            planned_date: Some("2026-07-15".into()),
            due_date: None,
            recurrence: Some(Recurrence::Daily),
            tag_ids: vec![],
        })
        .unwrap();
    assert!(db
        .add_task_v2(AddTaskV2 {
            title: "Forbidden child".into(),
            status: TaskStatus::Inbox,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: Some(recurring_root.id),
            notes: String::new(),
            planned_date: None,
            due_date: None,
            recurrence: None,
            tag_ids: vec![],
        })
        .is_err());

    assert!(db
        .update_task(
            &root.id,
            UpdateTask {
                title: None,
                status: None,
                priority: None,
                estimated_pomodoros: None,
                project_id: None,
                notes: None,
                planned_date: None,
                due_date: None,
                recurrence: Some(Some(Recurrence::Daily)),
                tag_ids: None,
            },
        )
        .is_err());
}

#[test]
fn completing_a_recurring_task_keeps_history_and_creates_the_next_date() {
    let db = Database::open_in_memory().unwrap();
    let task = db
        .add_task_v2(AddTaskV2 {
            title: "Monthly report".into(),
            status: TaskStatus::Active,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: None,
            notes: String::new(),
            planned_date: Some("2026-01-31".into()),
            due_date: None,
            recurrence: Some(Recurrence::Monthly),
            tag_ids: vec![],
        })
        .unwrap();

    db.set_task_completed(&task.id, true).unwrap();
    let tasks = db.list_tasks(None).unwrap();
    assert_eq!(tasks.len(), 2);
    assert_eq!(
        db.get_task(&task.id).unwrap().unwrap().status,
        TaskStatus::Completed
    );
    assert!(tasks.iter().any(|candidate| candidate.id != task.id
        && candidate.planned_date.as_deref() == Some("2026-02-28")
        && candidate.status == TaskStatus::Active));
}

#[test]
fn recurring_task_preserves_the_window_between_planned_and_due_dates() {
    let db = Database::open_in_memory().unwrap();
    let task = db
        .add_task_v2(AddTaskV2 {
            title: "Weekly window".into(),
            status: TaskStatus::Active,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: None,
            notes: String::new(),
            planned_date: Some("2026-07-01".into()),
            due_date: Some("2026-07-03".into()),
            recurrence: Some(Recurrence::Weekly),
            tag_ids: vec![],
        })
        .unwrap();

    db.set_task_completed(&task.id, true).unwrap();
    let next = db
        .list_tasks(None)
        .unwrap()
        .into_iter()
        .find(|candidate| candidate.id != task.id)
        .unwrap();
    assert_eq!(next.planned_date.as_deref(), Some("2026-07-08"));
    assert_eq!(next.due_date.as_deref(), Some("2026-07-10"));
}

#[test]
fn active_task_with_a_future_due_date_is_not_also_planned_for_today() {
    let db = Database::open_in_memory().unwrap();
    let task = db
        .add_task_v2(AddTaskV2 {
            title: "Upcoming".into(),
            status: TaskStatus::Active,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: None,
            notes: String::new(),
            planned_date: None,
            due_date: Some("2099-01-01".into()),
            recurrence: None,
            tag_ids: vec![],
        })
        .unwrap();

    assert_eq!(task.planned_date, None);
    assert_eq!(task.due_date.as_deref(), Some("2099-01-01"));
}

#[test]
fn bulk_delete_restores_quarantined_files_when_sqlite_rejects_delete() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("lyra.db");
    let db = Database::open(&path).unwrap();
    let stored = db
        .save_music_track(track(temp.path(), None, "Protected"))
        .unwrap();
    let second = rusqlite::Connection::open(&path).unwrap();
    second
        .execute_batch(
            "CREATE TRIGGER reject_track_delete BEFORE DELETE ON music_tracks BEGIN SELECT RAISE(ABORT, 'delete rejected'); END;",
        )
        .unwrap();

    assert!(db
        .delete_music_tracks(&[stored.id.clone()], temp.path())
        .is_err());
    assert!(Path::new(&stored.source_path).exists());
    assert!(db.get_music_track(&stored.id).unwrap().is_some());
}

#[test]
fn recurring_task_completion_is_idempotent_across_public_completion_paths() {
    let db = Database::open_in_memory().unwrap();
    let task = db
        .add_task_v2(AddTaskV2 {
            title: "Monthly report".into(),
            status: TaskStatus::Active,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: None,
            notes: String::new(),
            planned_date: Some("2026-01-31".into()),
            due_date: None,
            recurrence: Some(Recurrence::Monthly),
            tag_ids: vec![],
        })
        .unwrap();

    db.set_task_completed(&task.id, true).unwrap();
    db.set_task_completed(&task.id, true).unwrap();
    assert_eq!(db.list_tasks(None).unwrap().len(), 2);

    let next = db
        .list_tasks(None)
        .unwrap()
        .into_iter()
        .find(|candidate| candidate.id != task.id)
        .unwrap();
    db.update_task(
        &next.id,
        UpdateTask {
            title: None,
            status: Some(TaskStatus::Completed),
            priority: None,
            estimated_pomodoros: None,
            project_id: None,
            notes: None,
            planned_date: None,
            due_date: None,
            recurrence: None,
            tag_ids: None,
        },
    )
    .unwrap();

    let tasks = db.list_tasks(None).unwrap();
    assert_eq!(tasks.len(), 3);
    assert!(tasks.iter().any(|candidate| {
        candidate.status == TaskStatus::Active
            && candidate.planned_date.as_deref() == Some("2026-03-31")
    }));
}

#[test]
fn recurring_task_requires_a_date_when_created() {
    let db = Database::open_in_memory().unwrap();
    let result = db.add_task_v2(AddTaskV2 {
        title: "Undated recurrence".into(),
        status: TaskStatus::Inbox,
        priority: TaskPriority::None,
        estimated_pomodoros: None,
        project_id: None,
        parent_id: None,
        notes: String::new(),
        planned_date: None,
        due_date: None,
        recurrence: Some(Recurrence::Weekly),
        tag_ids: vec![],
    });
    assert!(result.is_err());
}

#[test]
fn completed_task_cannot_be_created_with_recurrence() {
    let db = Database::open_in_memory().unwrap();
    let result = db.add_task_v2(AddTaskV2 {
        title: "Already completed recurrence".into(),
        status: TaskStatus::Completed,
        priority: TaskPriority::None,
        estimated_pomodoros: None,
        project_id: None,
        parent_id: None,
        notes: String::new(),
        planned_date: Some("2026-07-15".into()),
        due_date: None,
        recurrence: Some(Recurrence::Weekly),
        tag_ids: vec![],
    });

    assert!(result.is_err());
    assert!(db.list_tasks(None).unwrap().is_empty());
}

#[test]
fn focus_completion_uses_the_same_idempotent_recurrence_transition() {
    let db = Database::open_in_memory().unwrap();
    let task = db
        .add_task_v2(AddTaskV2 {
            title: "Daily review".into(),
            status: TaskStatus::Active,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: None,
            notes: String::new(),
            planned_date: Some("2026-07-15".into()),
            due_date: None,
            recurrence: Some(Recurrence::Daily),
            tag_ids: vec![],
        })
        .unwrap();
    let focus = db
        .start_focus_session(&[task.id.clone()], "standard", None)
        .unwrap();

    db.complete_focus_session(&focus.id, 1_500, &[task.id.clone()])
        .unwrap();
    db.complete_focus_session(&focus.id, 1_500, &[task.id.clone()])
        .unwrap();

    let tasks = db.list_tasks(None).unwrap();
    assert_eq!(tasks.len(), 2);
    assert!(tasks.iter().any(|candidate| {
        candidate.status == TaskStatus::Active
            && candidate.planned_date.as_deref() == Some("2026-07-16")
    }));
}

#[test]
fn update_task_replaces_tags_atomically_and_can_clear_them() {
    let db = Database::open_in_memory().unwrap();
    for (id, name) in [("tag-a", "A"), ("tag-b", "B")] {
        db.save_tag(Tag {
            id: id.into(),
            name: name.into(),
        })
        .unwrap();
    }
    let task = db
        .add_task_v2(AddTaskV2 {
            title: "Tagged".into(),
            status: TaskStatus::Inbox,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: None,
            notes: String::new(),
            planned_date: None,
            due_date: None,
            recurrence: None,
            tag_ids: vec!["tag-a".into()],
        })
        .unwrap();

    let unchanged = UpdateTask {
        title: None,
        status: None,
        priority: None,
        estimated_pomodoros: None,
        project_id: None,
        notes: None,
        planned_date: None,
        due_date: None,
        recurrence: None,
        tag_ids: Some(vec!["tag-b".into()]),
    };
    assert_eq!(
        db.update_task(&task.id, unchanged).unwrap().tags[0].id,
        "tag-b"
    );

    let cleared = UpdateTask {
        title: None,
        status: None,
        priority: None,
        estimated_pomodoros: None,
        project_id: None,
        notes: None,
        planned_date: None,
        due_date: None,
        recurrence: None,
        tag_ids: Some(vec![]),
    };
    assert!(db.update_task(&task.id, cleared).unwrap().tags.is_empty());

    let invalid = UpdateTask {
        title: Some("Must roll back".into()),
        status: None,
        priority: None,
        estimated_pomodoros: None,
        project_id: None,
        notes: None,
        planned_date: None,
        due_date: None,
        recurrence: None,
        tag_ids: Some(vec!["missing-tag".into()]),
    };
    assert!(db.update_task(&task.id, invalid).is_err());
    assert_eq!(db.get_task(&task.id).unwrap().unwrap().title, "Tagged");
}

#[test]
fn update_task_json_distinguishes_missing_null_and_value() {
    let missing: UpdateTask = serde_json::from_str(r#"{"title":"Keep nullable fields"}"#).unwrap();
    assert_eq!(missing.estimated_pomodoros, None);
    assert_eq!(missing.project_id, None);

    let cleared: UpdateTask = serde_json::from_str(
        r#"{"estimatedPomodoros":null,"projectId":null,"plannedDate":null,"dueDate":null,"recurrence":null}"#,
    )
    .unwrap();
    assert_eq!(cleared.estimated_pomodoros, Some(None));
    assert_eq!(cleared.project_id, Some(None));
    assert_eq!(cleared.planned_date, Some(None));
    assert_eq!(cleared.due_date, Some(None));
    assert_eq!(cleared.recurrence, Some(None));

    let valued: UpdateTask = serde_json::from_str(
        r#"{"estimatedPomodoros":3,"projectId":"project-1","plannedDate":"2026-07-15","dueDate":"2026-07-16","recurrence":"weekly"}"#,
    )
    .unwrap();
    assert_eq!(valued.estimated_pomodoros, Some(Some(3)));
    assert_eq!(valued.project_id, Some(Some("project-1".into())));
    assert_eq!(valued.recurrence, Some(Some(Recurrence::Weekly)));
}

#[test]
fn music_track_query_defaults_sort_when_omitted() {
    let query: MusicTrackListQuery = serde_json::from_str(r#"{"query":"rain"}"#).unwrap();
    assert_eq!(query.query.as_deref(), Some("rain"));
    assert_eq!(query.sort, MusicTrackSort::CreatedDesc);
}

#[test]
fn completing_with_new_tags_copies_the_effective_tags_to_next_recurrence() {
    let db = Database::open_in_memory().unwrap();
    for (id, name) in [("tag-a", "A"), ("tag-b", "B")] {
        db.save_tag(Tag {
            id: id.into(),
            name: name.into(),
        })
        .unwrap();
    }
    let recurring = db
        .add_task_v2(AddTaskV2 {
            title: "Review".into(),
            status: TaskStatus::Active,
            priority: TaskPriority::None,
            estimated_pomodoros: None,
            project_id: None,
            parent_id: None,
            notes: String::new(),
            planned_date: Some("2026-07-15".into()),
            due_date: None,
            recurrence: Some(Recurrence::Daily),
            tag_ids: vec!["tag-a".into()],
        })
        .unwrap();

    db.update_task(
        &recurring.id,
        UpdateTask {
            title: None,
            status: Some(TaskStatus::Completed),
            priority: None,
            estimated_pomodoros: None,
            project_id: None,
            notes: None,
            planned_date: None,
            due_date: None,
            recurrence: None,
            tag_ids: Some(vec!["tag-b".into()]),
        },
    )
    .unwrap();

    let next = db
        .list_tasks(None)
        .unwrap()
        .into_iter()
        .find(|task| task.id != recurring.id)
        .unwrap();
    assert_eq!(
        next.tags
            .iter()
            .map(|tag| tag.id.as_str())
            .collect::<Vec<_>>(),
        vec!["tag-b"]
    );
}

#[test]
fn recovery_skips_incomplete_journals_without_blocking_startup() {
    let temp = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let root = temp.path().join(".delete-quarantine");
    let missing = root.join("missing");
    let malformed = root.join("malformed");
    std::fs::create_dir_all(&missing).unwrap();
    std::fs::create_dir_all(&malformed).unwrap();
    std::fs::write(malformed.join("journal.json"), b"not-json").unwrap();

    assert_eq!(db.recover_music_delete_quarantine(temp.path()).unwrap(), 0);
    assert!(!missing.exists());
    assert!(malformed.exists());
}

#[test]
fn save_music_track_removes_pending_file_when_database_insert_fails() {
    let temp = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let mut invalid = track(temp.path(), Some("missing-parent".into()), "Orphan");
    invalid.source = "SinOsc s => dac; 1::second => now;".into();

    assert!(db.save_music_track(invalid).is_err());
    let files = std::fs::read_dir(temp.path())
        .unwrap()
        .collect::<std::io::Result<Vec<_>>>()
        .unwrap();
    assert!(
        files.is_empty(),
        "database failure must not leave a .ck file"
    );
}

#[test]
fn save_music_track_does_not_insert_a_row_when_source_creation_fails() {
    let temp = tempfile::tempdir().unwrap();
    let not_a_directory = temp.path().join("not-a-directory");
    std::fs::write(&not_a_directory, "occupied").unwrap();
    let db = Database::open_in_memory().unwrap();

    assert!(db
        .save_music_track(track(&not_a_directory, None, "Cannot save"))
        .is_err());
    assert!(db.list_music_tracks().unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn bulk_delete_rejects_a_source_symlink_that_escapes_the_data_directory() {
    use std::os::unix::fs::symlink;

    let data = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let stored = db
        .save_music_track(track(data.path(), None, "Escaping source"))
        .unwrap();
    let bytes = std::fs::read(&stored.source_path).unwrap();
    let outside_source = outside.path().join("outside.ck");
    std::fs::write(&outside_source, bytes).unwrap();
    std::fs::remove_file(&stored.source_path).unwrap();
    symlink(&outside_source, &stored.source_path).unwrap();

    assert!(db
        .delete_music_tracks(&[stored.id.clone()], data.path())
        .is_err());
    assert!(db.get_music_track(&stored.id).unwrap().is_some());
    assert!(outside_source.exists());
}

#[cfg(unix)]
#[test]
fn bulk_delete_rejects_a_quarantine_symlink_that_escapes_the_data_directory() {
    use std::os::unix::fs::symlink;

    let data = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let stored = db
        .save_music_track(track(data.path(), None, "Protected source"))
        .unwrap();
    symlink(outside.path(), data.path().join(".delete-quarantine")).unwrap();

    assert!(db
        .delete_music_tracks(&[stored.id.clone()], data.path())
        .is_err());
    assert!(db.get_music_track(&stored.id).unwrap().is_some());
    assert!(Path::new(&stored.source_path).exists());
}

#[cfg(unix)]
#[test]
fn recovery_rejects_a_quarantine_symlink_that_escapes_the_data_directory() {
    use std::os::unix::fs::symlink;

    let data = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let external_directory = outside.path().join("must-survive");
    std::fs::create_dir_all(&external_directory).unwrap();
    symlink(outside.path(), data.path().join(".delete-quarantine")).unwrap();
    let db = Database::open_in_memory().unwrap();

    assert!(db.recover_music_delete_quarantine(data.path()).is_err());
    assert!(external_directory.exists());
}
