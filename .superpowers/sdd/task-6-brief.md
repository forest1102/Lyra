# Task 6: Music Alchemy screen

Redesign only `StudioScreen.tsx`, its tests, and new music-alchemy-only components/styles. Reuse `MoodOrb`, shared mood catalog, and generated `/moods/*.webp`. Do not edit shared context/bridge/domain/App or other screens.

- Heading `どんな空間で集中する？`; layout left mood board, center 360–480px Canvas orb, right recipe.
- Mood board has 5 categories × 6 image cards. Select 1–5; initial equal weights. Visible light trails/selection feedback flow toward orb; reduced motion shows static color bands/labels.
- Weights adjustable through right shadcn Sliders and orb points; always normalize before generation.
- Recipe summarizes mood labels/percent, resolved feeling text, and generation state.
- Main CTA height 68. Generate sends only recipe IDs/weights. During generation show phase Progress/Spinner and `生成を中止`.
- After generation never autoplay. Show explicit `検証して再生`; retain five-second validation, then allow save. If focus is active and validation deferred, explain it without stopping timer.
- Use shadcn Button, Slider, ToggleGroup, Progress, Alert, Badge, Skeleton/Spinner and Sonner. Avoid carding every list item.
- Meet 1180×780 and 900×620, 46px main heading, motion timings from plan.

Write failing tests first for 1–5 enforcement, equal/renormalized weights, recipe-only request, cancel, no autoplay, explicit validation/save, deferred focus behavior. Run focused/full frontend/typecheck/build. Report `.superpowers/sdd/task-6-report.md`; no commit.
