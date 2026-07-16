# Task 5: Task management screen

Redesign only `TasksScreen.tsx`, its tests, and new task-only components/styles. Do not edit shared domain/bridge/context/App or other screens.

- Create a 248px secondary rail for Inbox / 今日 / 近日 / 完了 / Projects; use shadcn Sheet fallback at narrow width.
- Today contains overdue due dates and plannedDate today. Upcoming is future planned/due work. Projects filter by projectId.
- Main rows are border-separated, not cards: drag handle, completion, title, project, priority, planned/due, estimate. Expanded row alone shows notes and one-level subtasks.
- Use shadcn Input, Checkbox, Badge, Collapsible, Calendar+Popover, Command+Popover, Empty, Button, and ScrollArea. Every Dialog/Sheet has a title.
- Use `@dnd-kit/react` + helpers with keyboard support. Recalculate position only inside the current visible status scope and call context reorder.
- Support multi-selection. Fixed bottom summary shows count and total estimated Pomodoros plus `選んだタスクで集中`; it updates context selectedTaskIds and navigates/focus action via the state API available.
- Preserve legacy quick-add through new rich add form defaults. Subtask/recurrence constraints should be reflected before submit.
- Meet 1180×780 and 900×620 layouts; no `space-x/y`, only approved gap/spacing scale.

Write failing behavior tests first: Today overdue rule, filters, selection total, expand, date/project interaction, keyboard reorder callback. Run focused/full frontend/typecheck/build. Report `.superpowers/sdd/task-5-report.md`; no commit.
