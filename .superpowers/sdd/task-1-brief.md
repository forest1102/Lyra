# Task 1: Browser runtime bridge and startup recovery

Implement Phase 0 browser/Tauri environment separation test-first.

Scope:

- Add explicit runtime detection for Tauri production, Tauri E2E, and browser development.
- Lazy-load a development-only BrowserDevBridge with in-memory tasks, presets, timer, tracks, fixed safe ChucK source, and subscriptions.
- Ensure the dev bridge is tree-shaken from production bundles.
- Show a friendly desktop-app-only message when a production bundle is opened outside Tauri.
- Keep bootstrap-data errors separate from subscription errors.
- Cover StrictMode double mount, unsubscribe, retry, and browser startup regression.
- Preserve existing desktop bridge behavior and current tests.

Do not touch Rust, screen redesign files, or shared styling. Follow red-green-refactor and report tests run.
