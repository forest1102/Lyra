use crate::music::generation::GeneratedMusicDraft;
use lyra_core::{Database, LyraError, MusicTrackRecord, NewMusicTrack};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TrackIntegrityError {
    #[error("track database operation failed: {0}")]
    Database(#[from] LyraError),
    #[error("track source could not be read: {0}")]
    Io(#[from] std::io::Error),
    #[error("track source SHA-256 does not match the database")]
    HashMismatch,
}

pub struct TrackStore<'a> {
    database: &'a Database,
    directory: PathBuf,
}

impl<'a> TrackStore<'a> {
    pub fn new(database: &'a Database, directory: impl AsRef<Path>) -> Self {
        Self {
            database,
            directory: directory.as_ref().to_path_buf(),
        }
    }

    pub fn save_draft(
        &self,
        draft: GeneratedMusicDraft,
    ) -> Result<MusicTrackRecord, TrackIntegrityError> {
        self.database
            .save_music_track(NewMusicTrack {
                parent_track_id: draft.parent_track_id,
                title: draft.title,
                description: draft.description,
                theme: draft.theme,
                arrangement: draft.arrangement,
                brightness: draft.brightness,
                density: draft.density,
                motion: draft.motion,
                bpm: draft.bpm.round() as i64,
                tail_seconds: draft.tail_seconds.round() as i64,
                source: draft.supercollider_source,
                canonical_seed: draft.canonical_seed,
                directory: self.directory.clone(),
            })
            .map_err(Into::into)
    }

    pub fn verify(&self, track: &MusicTrackRecord) -> Result<(), TrackIntegrityError> {
        let source = std::fs::read(&track.source_path)?;
        let digest = format!("{:x}", Sha256::digest(&source));
        if digest != track.source_sha256 {
            return Err(TrackIntegrityError::HashMismatch);
        }
        Ok(())
    }

    pub fn save_variation(
        &self,
        parent: &MusicTrackRecord,
        seed: i64,
    ) -> Result<MusicTrackRecord, TrackIntegrityError> {
        self.verify(parent)?;
        let source = std::fs::read_to_string(&parent.source_path)?;
        self.database
            .save_music_track(NewMusicTrack {
                parent_track_id: Some(parent.id.clone()),
                title: format!("{} — Variation", parent.title),
                description: parent.description.clone(),
                theme: parent.theme.clone(),
                arrangement: parent.arrangement.clone(),
                brightness: parent.brightness.clone(),
                density: parent.density.clone(),
                motion: parent.motion.clone(),
                bpm: parent.bpm,
                tail_seconds: parent.tail_seconds,
                source,
                canonical_seed: seed,
                directory: self.directory.clone(),
            })
            .map_err(Into::into)
    }
}
