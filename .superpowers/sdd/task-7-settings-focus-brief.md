# Task 7b: Settings and focus screens

Redesign `SettingsScreen.tsx`, `FocusScreen.tsx`, their tests, and screen-only components/styles. Do not edit context/bridge/domain/App or Tasks/Studio/Library.

## Settings

- Secondary rail: 一般 / 集中 / オーディオ / ランタイム / データ; Sheet at narrow width.
- General close behavior and login launch; Focus default preset, auto-break, notification, custom preset edit/delete; Audio volume, play-selected, crossfade 0–10; Runtime Codex/WebChucK assets/AudioContext/Worklet/SQLite; Data open folder. No reset and no SuperCollider.
- Use shadcn Field/Select/Switch/Slider/Dialog/Alert/Badge/Button/Item/Separator/Sonner. Every Dialog/Sheet has Title.
- Saving is explicit and applies AudioEngine settings via context without deck rebuild.

## Focus

- 66/34 split. Left: 132px timer, thin Progress, controls, Music Alchemy player. Right: selected tasks.
- No circular progress. Track changes/rename/delete/WebChucK failure must not stop timer. Two processor errors show recovery instruction while session remains active.
- Fixed chrome remains usable at 900×620.

Write failing tests first for settings defaults/save/runtime component list/no SuperCollider/preset delete/open folder and focus progress/audio-error timer independence. Run focused/full frontend/typecheck/build. Report `.superpowers/sdd/task-7-settings-focus-report.md`; no commit.
