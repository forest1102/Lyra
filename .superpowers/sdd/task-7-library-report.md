# Task 7a — Library screen report

## Scope

- `apps/desktop/src/screens/LibraryScreen.tsx`
- `apps/desktop/src/screens/LibraryScreen.test.tsx`
- `apps/desktop/src/screens/LibraryScreen.css`

No context, bridge, domain, shared style, Rust, App, or other screen files were edited by this task.

## Implemented

- Replaced the legacy card list with a shadcn `Table` using 70px rows and 64×46 mood thumbnails.
- Added local, immediate search; favorite/structure filters; and six sort orders. Query changes also flow through the settled `setLibraryQuery` API.
- Added accessible per-row selection and result-scoped select-all. A 54px selected toolbar exposes bulk delete.
- Added inline 240px title editing: Enter saves the trimmed title, Escape cancels, and empty/over-100-character input stays open with an inline error.
- Added exact bulk-delete copy: `選択したN曲を完全に削除しますか？`.
- Added stable-order deduplication and a hard 200-track UI boundary before calling context.
- Delegated playing-track stop → bridge delete ordering entirely to `deleteTracks`; the screen never stops music or mutates the timer as part of deletion.
- Preserved child tracks by rendering parent relationships from context state; `unlinkedChildIds` updates are reflected on the next context render.
- Added a fixed 108px WebChucK player with current title/recipe, playback/stop, focus-use, and volume controls.
- Preserved favorite toggling and verified ChucK source viewing through a titled shadcn `Dialog`.
- Removed legacy `themeLabel(track.theme)` usage, so `mood-alchemy` is no longer passed to the old `MusicTheme`-only label helper.
- Used semantic tokens only; no raw screen colors and no `space-x/y` utilities.

## TDD evidence

RED was observed before implementation: all eight new Library tests failed because search/selection/edit/delete UI and `prepareBulkDeleteIds` did not exist.

GREEN after implementation:

```text
bunx vitest run --root ../.. apps/desktop/src/screens/LibraryScreen.test.tsx
Test Files  1 passed (1)
Tests       8 passed (8)
```

Coverage includes:

- result-only select-all
- Enter rename with trimming
- Escape cancellation
- empty and 101-character rejection
- exact delete count/copy
- playing and non-playing deletion delegation without timer access
- dedupe and 201-track rejection

## Verification

```text
bunx vitest run --root ../.. apps/desktop/src/screens/LibraryScreen.test.tsx apps/desktop/src/App.test.tsx
Test Files  2 passed (2)
Tests       11 passed (11)

bun run --cwd apps/desktop typecheck
PASS

bun run --cwd apps/desktop build
PASS (existing Vite large-chunk warning only)

git diff --check -- apps/desktop/src/screens/LibraryScreen.tsx apps/desktop/src/screens/LibraryScreen.test.tsx apps/desktop/src/screens/LibraryScreen.css
PASS
```

The full frontend run completed 108/110 tests. The only failures were both in the concurrently edited `TasksScreen.test.tsx` (Radix Select/jsdom `hasPointerCapture` and completed-task checkbox disable); all eight Library tests passed in that run. No Task files were changed here.
