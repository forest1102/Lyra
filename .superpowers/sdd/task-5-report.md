# Task 5 Report — Task management screen

## Result

Phase 1 のタスク管理画面を `TasksScreen` とタスク専用コンポーネント/CSSだけで刷新した。

- 248px二次ナビ: `Inbox / 今日 / 近日 / 完了 / Projects`
- 1279px以下ではTitle付きshadcn Sheetへ切替
- 今日: 未完了の期限超過、または`plannedDate`が当日のタスク
- 近日: 当日より後の予定日/期限を持つ未完了タスク
- 行中心の一覧: DnD、選択、完了、タイトル、Project、優先度、予定/期限、見積
- 展開時だけメモ、Tag検索、期限、1階層サブタスクを表示
- 繰り返しタスクのサブタスク追加をUIで禁止
- 繰り返しタスクは予定日または期限がない場合、理由を表示してsubmitを無効化
- 完了タスクは集中対象の選択を無効化
- rich quick-add: Project、予定日、期限、優先度、繰り返しを省略可能な既定値付きで追加
- Calendar + Popover、Project/TagのCommand + Popover
- `PointerSensor`と`KeyboardSensor`を明示した`@dnd-kit/react` sortable
- `Alt + ArrowUp/ArrowDown`でも同一visible status scopeだけを並べ替え
- 選択件数、合計Pomodoro、`選んだタスクで集中`を固定フッターに表示
- 集中CTAは現行の確定済みstate API `dispatchTimer({ type: "start" })`を使用
- 1180×780では二次ナビをSheet化、900×620では行メタをコンパクト表示
- 生色、`space-x/y`、行カード、画面内シャドウは不使用

## TDD

最初に `TasksScreen.test.tsx` を追加して6件すべてが失敗することを確認し、レビュー所見2件も失敗テストを確認してから修正した。

1. Todayの期限超過ルール
2. 近日・完了・Projectフィルタ
3. 行展開時だけのメモ/サブタスク表示
4. 選択件数とPomodoro合計、集中開始
5. Calendar/Project Commandからの更新
6. キーボード並べ替えcallback
7. 繰り返しタスクの日付必須UI
8. 完了タスクの集中選択禁止

実装後、8件がすべて成功した。

## Files

- `apps/desktop/src/screens/TasksScreen.tsx`
- `apps/desktop/src/screens/TasksScreen.test.tsx`
- `apps/desktop/src/screens/TasksScreen.css`
- `apps/desktop/src/components/tasks/TaskRail.tsx`
- `apps/desktop/src/components/tasks/TaskRow.tsx`
- `apps/desktop/src/components/tasks/TaskDatePicker.tsx`
- `apps/desktop/src/components/tasks/TaskCombobox.tsx`
- `apps/desktop/src/components/tasks/TaskTagPicker.tsx`

## Verification

- `bunx vitest run --root . apps/desktop/src/screens/TasksScreen.test.tsx`
  - PASS: 1 file, 8 tests
- `bun run --cwd apps/desktop build`
  - PASS: Vite production build、2928 modules
  - 既存のchunk size warningのみ
- scoped `git diff --check`
  - PASS
- `bun run --cwd apps/desktop typecheck`
  - PASS
- `bun run --cwd apps/desktop test`
  - Tasksを含む19 files / 110 testsはPASS
  - 並行実装中の`StudioScreen`の重み下限テスト1件だけがFAILし、全体としてはFAIL

## Integration note

`LyraState`には画面遷移APIがないため、集中CTAは選択状態を維持したまま集中セッションを開始する。App側でタスク画面から集中画面へ遷移させる場合は、親統合時に画面ナビゲーションを接続する。
