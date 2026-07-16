# Task 1 report: Browser runtime bridge and startup recovery

## Implemented

- Added explicit runtime classification for `tauri-production`, `tauri-e2e`, `browser-development`, and `unsupported-browser`.
- Moved application mounting into a testable bootstrap boundary.
- Browser development now lazy-loads a new in-memory `BrowserDevBridge` instead of invoking Tauri APIs.
- The development bridge provides tasks, presets, timer state and events, music tracks, draft generation/validation/save, a fixed safe ChucK source, and a matching SHA-256.
- Production bundles opened outside Tauri render `デスクトップアプリから起動してください` without constructing the desktop provider.
- Split bootstrap-data failures (`startupError`) from event subscription failures (`subscriptionError`). A subscription failure leaves an already-loaded app usable and provides a reconnect action.
- Covered StrictMode double mount, late subscription cleanup, normal unsubscribe, subscription retry, and browser-only startup.
- Confirmed the production Vite build contains the desktop-only message and does not contain BrowserDevBridge strings or a BrowserDevBridge chunk.

## Files changed

- `apps/desktop/src/main.tsx`
- `apps/desktop/src/bootstrap.tsx`
- `apps/desktop/src/bootstrap.test.tsx`
- `apps/desktop/src/services/runtime.ts`
- `apps/desktop/src/services/runtime.test.ts`
- `apps/desktop/src/services/browserDev.ts`
- `apps/desktop/src/services/browserDev.test.ts`
- `apps/desktop/src/state/LyraContext.tsx`
- `apps/desktop/src/state/LyraContext.test.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/App.test.tsx`

## RED evidence

- `bunx vitest run --root . apps/desktop/src/services/runtime.test.ts`
  - Failed because `services/runtime` did not exist.
- `bunx vitest run --root . apps/desktop/src/services/browserDev.test.ts`
  - Failed because `services/browserDev` did not exist.
- `bunx vitest run --root . apps/desktop/src/bootstrap.test.tsx`
  - Failed because the bootstrap boundary did not exist.
- `bunx vitest run --root . apps/desktop/src/state/LyraContext.test.tsx`
  - Reproduced the overwrite: only `event listener unavailable` remained and `database unavailable` disappeared.
- `bunx vitest run --root . apps/desktop/src/App.test.tsx`
  - Failed because a subscription failure was not shown independently in the ready application.
- BrowserDevBridge SHA regression test initially failed with the placeholder hash and reported the actual source digest.

## GREEN evidence

- `bunx vitest run --root . apps/desktop/src/services/runtime.test.ts apps/desktop/src/services/browserDev.test.ts apps/desktop/src/bootstrap.test.tsx apps/desktop/src/state/LyraContext.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/services/desktop.test.ts`
  - 6 files, 28 tests passed.
- `bun run --cwd apps/desktop build`
  - Production Vite build succeeded; WebChucK assets copied.
- `git diff --check -- <task files>`
  - Passed.
- `bun run --cwd apps/desktop dev:ui`
  - Vite started successfully on `http://127.0.0.1:1420/` without the former terminal-side startup failure.

## Remaining / external to this task

- In-app browser discovery returned no available browser backend, so visual inspection and live console collection could not be performed from this agent. The jsdom bootstrap integration test exercises the same browser-development mount path and proves the app reaches the main navigation without Tauri internals.
- The whole frontend suite/typecheck was temporarily blocked by another in-progress TDD task's missing `components/music/MoodOrb` module. All 28 Phase 0 scoped tests passed; the unrelated RED test should be rechecked after that task turns GREEN.
- No commit was created, as requested.

## Review follow-up

The `CHANGES REQUESTED` items in `task-1-review.md` were reproduced and addressed:

- Startup loads now carry a monotonically increasing generation. StrictMode cleanup invalidates the previous generation, and only the newest success or failure may update startup state.
- Added reverse-resolution tests for a stale StrictMode success and a stale rejected request after duplicate startup retries.
- Added `retrySubscriptions()` as a separate state API. The subscription banner uses it without setting `ready=false` or reloading tasks, tracks, presets, and timer state.
- Added tests proving a successful and a repeatedly failing Event reconnect both preserve the ready application and do not call `listTasks` again.
- BrowserDevBridge now runs a single 250ms timer scheduler while a running timer has subscribers, mirrors the Rust completion transition to `awaiting_break`, and clears the scheduler when the final listener unsubscribes.
- Tauri E2E classification now requires both the E2E flag and Tauri internals. A flag-only production bundle is unsupported; a flag-only development page remains browser development.
- Added a production-build regression test that creates a real Vite artifact with a manifest and checks that no BrowserDev chunk, `browser-dev://` source, or fixed development track title is present. It also verifies that the desktop-app-only message remains in the artifact.

### Review RED evidence

- `LyraContext.test.tsx`: stale StrictMode success replaced the newer task list; stale duplicate-retry rejection set `startupError`; `retrySubscriptions` did not exist.
- `App.test.tsx`: clicking `再接続` called `retryStartup` rather than a subscription-only API.
- `browserDev.test.ts`: advancing fake time produced no timer state events and a zero-duration focus stayed `running`.
- `runtime.test.ts`: an E2E flag without Tauri internals was classified as `tauri-e2e`.
- The first production-build test run intentionally exposed a test-environment detail: Vitest's `NODE_ENV=test` retains the development dynamic import. The test now explicitly creates a production-mode build and restores the environment afterward.

### Review GREEN evidence

- `bunx vitest run --root . apps/desktop/src/services/runtime.test.ts apps/desktop/src/services/browserDev.test.ts apps/desktop/src/bootstrap.test.tsx apps/desktop/src/state/LyraContext.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/services/desktop.test.ts apps/desktop/viteConfig.test.ts`
  - 7 files, 37 tests passed.
- `bun run --cwd apps/desktop typecheck`
  - Both application and E2E TypeScript checks passed.
- `bun run --cwd apps/desktop build`
  - Production build passed and copied both verified WebChucK assets.
