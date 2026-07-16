# Task 2 review fixes

## Outcome

All P1/P2 findings in `task-2-review.md` were reproduced or verified and fixed in the Rust/Cargo scope. No frontend TypeScript, package, or stylesheet files were edited.

## Data-safety fixes

- Music deletion now writes a durable per-operation `journal.json` under the in-data-directory `.delete-quarantine` before moving any source.
- A prepare or SQLite failure restores every moved source. Restore errors are aggregated, returned with the preserved quarantine path, and never followed by quarantine deletion.
- A purge failure after SQLite commit is treated as cleanup debt rather than a contradictory command failure. `Database::recover_music_delete_quarantine` checks journal IDs against SQLite on launch: rows present means restore; rows absent means purge.
- The quarantine root and every source are canonicalized and contained inside the configured data directory. Escaping source and quarantine symlinks are rejected.
- New `.ck` saving uses a hidden pending file plus a SQLite transaction and atomic rename. Write, transaction-start, insert, rename, or commit failures clean pending/final files and preserve the database/file invariant.
- `save_music_draft` keeps the draft map locked and removes a draft only after successful persistence, so validation or storage failure remains retryable.

## Task consistency fixes

- Task completion is now one transaction helper used by `set_task_completed`, `update_task`, and `complete_focus_session`.
- The helper performs only an incomplete-to-completed transition, making IPC retries idempotent and creating at most one next recurring occurrence.
- Focus completion verifies the session transition and task/session links and commits the focus row, task rows, recurring successors, and copied tags together.
- Recurring task creation/update rejects inputs without either `plannedDate` or `dueDate`.
- Monthly recurrence persists an internal `recurrence_anchor_day`, preserving `2026-01-31 -> 2026-02-28 -> 2026-03-31`.
- `UpdateTask` now accepts `tagIds: Option<Vec<String>>`; omitted means unchanged and an empty array clears tags. Metadata and join-table replacement share one transaction.

## Settings and native wiring fixes

- Core settings validation is exposed as a side-effect-free step and is reused by persistence.
- The Tauri save workflow validates first, applies autostart only when changed, persists second, and compensates back to the previous OS autostart value if persistence fails. A rollback failure is included in the returned error.
- Added `open_data_directory`, backed only by `NativePaths::data_directory`, registered in the invoke handler, and initialized `tauri-plugin-opener`.
- Startup now recovers durable music-delete quarantine journals after opening SQLite.

## Failure-injection and regression coverage

- Partial multi-file quarantine move failure restores already moved sources.
- Restore rename failure preserves the only source copy in quarantine and a later startup recovery restores it.
- Post-commit purge failure returns deletion success and is cleaned on recovery.
- SQLite trigger rejection rolls deletion back and restores the source.
- Source/quarantine symlink escapes are rejected.
- A v5 migration failure rolls v4 back in the same transaction, preserving the v3 schema/data.
- v3-to-v5 migration covers parent/child tracks, focus history, settings, and idempotent reopen.
- Music INSERT FK failure and source-creation failure leave neither orphan rows nor files.
- Invalid settings cause no OS/persistence call; persistence failure applies autostart then rolls it back.
- Failed draft persistence retains the draft.
- Repeated normal/focus completion, update-to-completed, tag replacement/clear/rollback, missing recurrence dates, and multi-month anchor behavior are covered.

## Files changed for this review pass

- `crates/lyra-core/src/lib.rs`
- `crates/lyra-core/tests/refresh.rs`
- `crates/lyra-core/tests/repository.rs`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `Cargo.lock`

## Verification

- `nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test -p lyra-core --test refresh` — 18 passed.
- `nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test --workspace` — passed; the existing Codex live test remains ignored because it requires authentication/network.
- `nix shell nixpkgs#cargo nixpkgs#rustc -c cargo check --workspace` — passed.
- `nix shell nixpkgs#cargo nixpkgs#rustfmt -c cargo fmt --all -- --check` — passed.
- `git diff --check` — passed.

No commit was created.
