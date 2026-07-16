# Task 2: Rust migrations and domain commands

Implement the complete Rust/data portion of approved Phases 1–4 with tests first. Do not edit React/TypeScript files except the shared versioned mood catalog JSON under `apps/desktop/shared/`.

## Task migration v4

- Preserve old tasks while adding status (`inbox|active|completed`), priority (`none|low|medium|high`), projects, tags and join table, project_id, parent_id, notes, planned_date, due_date, position, completed_at, recurrence (`daily|weekly|monthly`).
- Existing completed -> completed; Today -> active + migration local calendar date; Backlog -> inbox. Dates remain `YYYY-MM-DD` without timezone conversion.
- Completion of recurring roots leaves the completed row and creates the next occurrence. Clamp monthly dates to month end. Recurring tasks cannot be subtasks; subtasks are one level only.
- Keep old `TaskList`, `completed`, and MCP add_task compatibility at serde/API boundaries while making defaults deterministic.
- Add update/list/reorder helpers needed by the approved UI, with input validation.

## Music migration v5 and recipe

- Create a single JSON mood catalog at `apps/desktop/shared/moods.v1.json`, consumed by Rust with `include_str!` and later importable by React. It must define 5 categories × 6 moods and vectors brightness/density/motion/warmth/space/pulse/melody/organic plus labels/visual metadata.
- Add `MusicRecipeV1 { version: 1, moods }`; validate version, 1–5 unique known IDs, each weight finite/in range, and normalized total. Resolve normalized vectors and a structure family from ambient/lofi/minimal-melody/organic-pulse/downtempo/neoclassical.
- Update the Codex generation request/prompt contract to use normalized recipe, structure family, tempo range, and timbre guidance while preserving the existing ChucK safety contract, 48KiB limit, allowlist, seed placeholder, loop contract, cancellation, and one repair.
- Migration v5 adds recipe_version, recipe_json, structure_family and rebuilds parent FK as `ON DELETE SET NULL`. Existing post-v3 tracks become a versioned `legacy` recipe derived from current metadata.

## Library commands

- Add rename (trim 1–100, duplicate allowed; DB title only), filtered/sorted list contract, and bulk deletion (dedupe, 1–200).
- Bulk delete must quarantine `.ck` files inside the configured data directory, run DB changes transactionally, restore every file on DB/file failure, purge after commit, and return `{ deletedIds, unlinkedChildIds }`. Children not deleted remain and get NULL parent.
- Cover success, missing/tampered files, DB failure, file failure, child unlinking, and 201 IDs.

## Settings/runtime support

- Add versioned settings JSON structs/defaults for close behavior hide, autostart false, standard preset, auto break false, notification current behavior, volume 1.0, start-selected true, crossfade 2.0 range 0–10.
- CRUD custom presets including delete protection for built-ins.
- Add runtime diagnostic Rust result for codex, webchuck-assets, sqlite where appropriate. Never add SuperCollider.

## Wiring

- Wire new Tauri commands in `commands.rs` and `lib.rs`; add capability/plugin changes only if required by these Rust features. Keep desktop bridge TypeScript untouched.
- Keep APIs camelCase over serde and make errors actionable.
- Update track store/generation/prompt/tests and MCP schema/tests for backward-compatible optional fields.

Run RED and GREEN commands for focused Rust tests, then `cargo test --workspace` and `cargo fmt --check`. Create `.superpowers/sdd/task-2-report.md` with files, tests, exact public contracts, and remaining integration notes. Do not commit.
