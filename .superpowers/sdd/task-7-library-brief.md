# Task 7a: Library screen

Redesign only `LibraryScreen.tsx`, its tests, and library-only components/styles. Do not edit context/bridge/domain/App or other screens.

- shadcn Table with search, favorite/structure filters, sort, multiple selection. Row 70px, mood thumbnail 64×46, selected toolbar 54px.
- Select-all targets only the current filtered result.
- Inline title Input width 240px: Enter save, Escape cancel, trim 1–100, duplicates allowed.
- Bulk delete dedupes and caps at 200; AlertDialog exact title `選択したN曲を完全に削除しますか？`. If the playing ID is selected, state API stops audio before bridge deletion; never touches timer.
- Keep surviving children, update displayed parent relation from returned unlinkedChildIds.
- Fixed 108px bottom WebChucK player with track title/recipe, play/pause/stop/focus-use, volume. Content leaves room for it at height 620.
- Use shadcn Table/Input/InputGroup/Checkbox/Select/DropdownMenu/AlertDialog/Empty/Badge/Button/Slider/Sonner.
- No raw colors, no list cards, no `space-x/y`.

Write failing tests first for filter-only select-all, inline keyboard rename, validation, exact confirmation copy/count, playing vs non-playing delete ordering/timer independence, 201 rejection. Run focused/full frontend/typecheck/build. Report `.superpowers/sdd/task-7-library-report.md`; no commit.
