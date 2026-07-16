# Task 3 report: Frontend contracts, state, and audio integration

## Implemented

- Extended the TypeScript domain for task v4, recipe-backed music v5, library queries/deletion, app settings, and runtime diagnostics while retaining the legacy task list and legacy music-generation request.
- Added desktop IPC methods for v2 task operations, projects/tags, preset deletion, filtered tracks, rename/bulk delete, settings, diagnostics, and opening the data directory. Recipe generation is wrapped as `{ request: { recipe } }`; legacy controls remain flat.
- Brought `BrowserDevBridge` to parity with the new contract using in-memory projects, tags, settings, task metadata, filtered/sorted music, rename/delete, preset deletion, diagnostics, and cancellable recipe generation. The existing timer scheduler/last-listener cleanup behavior is preserved.
- Startup now loads projects, tags, settings, and applies master volume/crossfade without recreating decks. Existing startup-generation and disposed-subscription guards were retained.
- Added optimistic v2 task update/reorder helpers, selected Pomodoro totals, and a 1.5-second poll guard which skips in-flight mutations and rejects stale poll responses by mutation revision, then resolves newer `updatedAt` values.
- Added library query, inline rename, and bulk delete state APIs. Audio stops only when the currently playing track is deleted; no timer event is dispatched.
- Added settings save/preset delete/data-directory APIs and merged Rust diagnostics with browser-owned WebChucK asset, AudioContext, and Worklet diagnostics. Diagnostic AudioContexts are always closed.
- Added generation revision guards so cancelled/stale responses cannot replace the current draft. Deferred focus drafts become explicitly validatable after the focus-running timer state ends.

## Tests added/updated

- Desktop command argument contracts, including `open_data_directory`.
- BrowserDev parity and cancellation.
- Browser diagnostics success/failure and AudioContext cleanup.
- Settings-to-AudioEngine application without playback/deck recreation.
- Playing vs non-playing bulk delete and timer independence.
- Stale generation after cancellation.
- Deferred draft transition after focus end.
- Native/browser diagnostic merge.

## Verification

- PASS: `./node_modules/.bin/vitest run apps/desktop/src/services/desktop.test.ts apps/desktop/src/services/browserDev.test.ts apps/desktop/src/services/diagnostics.test.ts apps/desktop/src/state/LyraContext.test.tsx apps/desktop/src/services/musicGeneration.test.ts` (5 files, 40 tests).
- PASS: `bun run --cwd apps/desktop build`.
- PASS for this task's files during full frontend run; full run currently reports 6 failures exclusively in newly added `FocusScreen.test.tsx` and `SettingsScreen.test.tsx`, whose screen implementations are owned by later UI tasks.
- `bun run --cwd apps/desktop typecheck` currently reaches only old screen contract errors: `StudioScreen.tsx` reads legacy fields from the new recipe/legacy union, and `LibraryScreen.tsx` sends the new `mood-alchemy` theme to a legacy-only label helper. Both screens are outside Task 3 scope and are scheduled for replacement.
- PASS: `git diff --check` for all Task 3 tracked files.

No commit created, per task brief.
