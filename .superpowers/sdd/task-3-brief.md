# Task 3: Frontend contracts, state, and audio integration

Integrate the new Rust contracts into TypeScript test-first. Do not redesign screen markup; make state APIs ready for screen agents.

## Domain and bridge

- Extend Task with status/priority/projectId/parentId/notes/plannedDate/dueDate/position/completedAt/recurrence/tags while retaining `list` and `completed` compatibility.
- Add Project, Tag, AddTaskV2, UpdateTask, AppSettingsV1, RuntimeDiagnostic, MusicTrackListQuery, DeleteMusicTracksResult, and recipe fields on draft/track.
- Change primary generation request to `{ version: 1, moods }`, retaining legacy request typing only as a compatibility union.
- Extend DesktopBridge and desktopBridge with addTaskV2/update/reorder/projects/tags, filtered tracks, rename, bulk delete, get/save settings, delete preset, diagnostics.
- Keep BrowserDevBridge complete and in-memory for every new method.

## Lyra state

- Load tasks, tracks, presets, timer, projects, tags, settings at startup without regressing Phase 0 stale-request/subscription guards.
- Apply settings to AudioEngine via `setVolume` and `setCrossfadeSeconds` without deck recreation.
- Expose task CRUD/reorder/select helpers and selected Pomodoro total.
- Expose library query, inline rename, bulk delete. Stop AudioEngine first only if deleted IDs contain the playing track; do not dispatch timer events.
- Expose save settings/preset delete/runtime diagnostics. Merge Rust codex/sqlite diagnostics with browser-owned webchuck-assets/audio-context/worklet diagnostics.
- Expose deferred draft validation when focus ends; stale/cancelled generation drafts must not replace current draft.
- Preserve the 1.5s poll without overwriting optimistic/local edits: use updatedAt-aware merge or a mutation revision guard.

## Audio

- Use already-added `AudioEngine.setVolume` and `setCrossfadeSeconds`; add any missing diagnostic hooks with real behavior tests.
- Processor errors and all library mutations must never change timer state.

## Tests

RED then GREEN for new bridge command args, BrowserDev parity, settings application, playing-track delete vs non-playing delete, timer independence, stale generation/cancel, deferred validation, poll/local edit conflict, and diagnostics merge. Run full frontend suite/typecheck/build. Report in `.superpowers/sdd/task-3-report.md`; do not commit.
