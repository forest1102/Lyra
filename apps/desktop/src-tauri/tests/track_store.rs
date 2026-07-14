use lyra_core::Database;
use lyra_desktop::music::generation::GeneratedMusicDraft;
use lyra_desktop::music::track_store::{TrackIntegrityError, TrackStore};

fn draft(source: &str) -> GeneratedMusicDraft {
    GeneratedMusicDraft {
        id: "draft-1".into(),
        parent_track_id: None,
        title: "Stored track".into(),
        description: "A test track".into(),
        theme: "deep-space".into(),
        brightness: "medium".into(),
        density: "low".into(),
        motion: "low".into(),
        bpm: 64.0,
        tail_seconds: 4.0,
        supercollider_source: source.into(),
        source_sha256: "generated-hash".into(),
        canonical_seed: 42,
        audio_validation: "required".into(),
    }
}

#[test]
fn saves_and_verifies_a_managed_scd_file() {
    let directory = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let store = TrackStore::new(&db, directory.path());
    let track = store.save_draft(draft("(~lyraTrack = ());")).unwrap();

    assert!(store.verify(&track).is_ok());
    assert!(std::path::Path::new(&track.source_path).starts_with(directory.path()));
}

#[test]
fn detects_source_tampering_before_playback() {
    let directory = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let store = TrackStore::new(&db, directory.path());
    let track = store.save_draft(draft("(~lyraTrack = ());")).unwrap();
    std::fs::write(&track.source_path, "tampered").unwrap();

    assert!(matches!(
        store.verify(&track),
        Err(TrackIntegrityError::HashMismatch)
    ));
}

#[test]
fn saves_a_variation_as_a_child_with_a_new_seed() {
    let directory = tempfile::tempdir().unwrap();
    let db = Database::open_in_memory().unwrap();
    let store = TrackStore::new(&db, directory.path());
    let parent = store.save_draft(draft("(~lyraTrack = ());")).unwrap();
    let variation = store.save_variation(&parent, 84).unwrap();

    assert_eq!(
        variation.parent_track_id.as_deref(),
        Some(parent.id.as_str())
    );
    assert_eq!(variation.canonical_seed, 84);
}
