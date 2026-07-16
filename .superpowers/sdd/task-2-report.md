# Task 2 report: Rust migrations and domain commands

## Outcome

Implemented the Rust/data portion of the Lyra refresh without reintroducing SuperCollider, sclang, scsynth, or OSC. Database migrations now advance through v4 (tasks) and v5 (music recipes and parent unlink semantics). The versioned mood catalog is shared at `apps/desktop/shared/moods.v1.json` and is compiled into `lyra-core` with `include_str!`.

## Files changed

- `crates/lyra-core/src/lib.rs`
- `crates/lyra-core/tests/refresh.rs`
- `crates/lyra-core/tests/repository.rs`
- `crates/lyra-mcp/src/lib.rs`
- `apps/desktop/shared/moods.v1.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/music/generation.rs`
- `apps/desktop/src-tauri/src/music/prompt.rs`
- `apps/desktop/src-tauri/src/music/track_store.rs`
- `apps/desktop/src-tauri/tests/generation.rs`
- `apps/desktop/src-tauri/tests/track_store.rs`
- `Cargo.lock`

## Public contracts

### Tasks

- Existing `AddTask { title, list, estimatedPomodoros }`, `TaskList`, `completed`, `add_task`, `set_task_completed`, and `move_task` remain available.
- `Task` now also serializes `status`, `priority`, `projectId`, `parentId`, `notes`, `plannedDate`, `dueDate`, `position`, `completedAt`, `recurrence`, and `tags` in camelCase.
- New core inputs: `AddTaskV2`, `UpdateTask`.
- New Tauri commands:
  - `add_task_v2(input) -> Task`
  - `update_task(id, input) -> Task`
  - `reorder_tasks(ids, status) -> ()`
  - `list_projects() -> Project[]`
  - `save_project(project) -> Project`
  - `list_tags() -> Tag[]`
  - `save_tag(tag) -> Tag`
- Recurring roots retain the completed row and create a new active occurrence. Monthly dates clamp to month end. A recurring task cannot have a parent and subtasks cannot be nested beyond one level.
- MCP `add_task` keeps `title`, `list`, and `estimatedPomodoros`, while accepting optional `priority`, `projectId`, `parentId`, `notes`, `plannedDate`, `dueDate`, `recurrence`, and `tagIds`.

### Music recipe

- `MusicRecipeV1 { version: 1, moods: MoodSelection[] }` uses camelCase mood IDs.
- `resolve()` enforces version 1, 1–5 unique catalog IDs, finite positive weights at most 1, and normalizes the total.
- Resolved values include all eight vectors, one of `ambient|lofi|minimal-melody|organic-pulse|downtempo|neoclassical`, tempo range, and timbre guidance.
- The Codex prompt includes normalized recipe JSON, vectors, structure family, tempo range, and timbre guidance while preserving the existing ChucK source policy, size limit, seed placeholder, loop checks, cancellation, deferred focus validation, and one repair.
- Generated drafts and stored tracks now expose `recipeVersion`, `recipeJson`, and `structureFamily`.

### Library

- `list_music_tracks(query?: MusicTrackListQuery) -> MusicTrackRecord[]`. Omitting `query` preserves the old list behavior.
- `rename_music_track(id, title) -> MusicTrackRecord`; trims and validates 1–100 characters, allows duplicates, and changes only the SQLite title.
- `delete_music_tracks(ids) -> { deletedIds, unlinkedChildIds }`; deduplicates and accepts 1–200 IDs.
- Core bulk deletion verifies path containment and SHA-256, moves sources into an in-data-directory quarantine, unlinks surviving children, deletes in a SQLite transaction, restores every moved file if file preparation or SQLite deletion fails, and purges quarantine after commit.

### Settings and runtime

- `get_app_settings() -> AppSettingsV1`
- `save_app_settings(settings) -> AppSettingsV1`
- `delete_timer_preset(id) -> ()` protects built-ins.
- `runtime_diagnostics() -> RuntimeDiagnostic[]` returns Rust-side Codex and SQLite checks; WebChucK/AudioContext/Worklet checks remain frontend-owned.
- Settings defaults: hide on close, autostart false, standard preset, auto-break false, notifications true, volume 1.0, selected-track playback true, crossfade 2.0.
- Crossfade validates 0–10 and master volume validates 0–1.
- Tauri autostart plugin is initialized with the macOS LaunchAgent launcher; saving settings updates OS autostart before persisting JSON.
- CloseRequested now reads persisted close behavior (`hide` or `quit`).

## TDD evidence and verification

- RED: `nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test -p lyra-core --test refresh`
  - failed on missing v4/v5 types, fields, recipe resolver, rename/list/delete, and settings APIs.
- GREEN focused: same command; 10/10 tests pass.
- Generation RED/GREEN: `cargo test -p lyra-desktop --test generation --no-run`, then recipe prompt test passes.
- Final: `nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test --workspace`
  - all Rust tests pass; one pre-existing live Codex test remains ignored because it requires authentication/network.
- Final: `nix shell nixpkgs#cargo nixpkgs#rustfmt -c cargo fmt --all -- --check`
  - passes.

## Integration notes

- Frontend callers may continue invoking `list_music_tracks` without a `query`; new library UI should pass the optional query object.
- Frontend generation should send `{ recipe: { version: 1, moods: [...] } }`; the legacy five-control request remains accepted.
- The frontend should merge its WebChucK/AudioContext/Worklet diagnostics with the Rust `runtime_diagnostics` result.
- No commit was created, per the task brief.
