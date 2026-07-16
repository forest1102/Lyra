# UI/UX final review

## Verdict

**CHANGES REQUESTED**

主要画面の構成、shadcn/Radix経由の実装、Dialog/SheetのTitle、1〜5件のムード選択、重み正規化、ライブラリの改名・結果範囲選択・200件上限、固定プレイヤー、設定既定値、BGM障害時のタイマー継続は確認できた。一方、生成中止、集中対象、ライブラリ検索でユーザー操作により再現可能な競合が残っているため、承認不可とする。

## Findings

### [P1] 生成中止後に再生成すると、古いPromiseが新しい生成状態を破壊する

- `apps/desktop/src/screens/StudioScreen.tsx:56` の単一 `cancelled` booleanを全生成で共有し、再生成時に `false` へ戻している (`:78-96`)。
- 中止した生成がまだsettleしていない間に「このムードで生成」を再度押すと、古い生成のrejectが新しい生成のrejectとして扱われ、`phase="failed"` とエラーを設定する。`generating`もfalseになり、実際には二つ目が進行中でも生成ボタンを再度押せる。
- Rust側は中止要求後もしばらく `generation_active` を保持するため、この操作は現実的に発生する。各run固有のrevision/Abort tokenで、古いphase・resolve・rejectをすべて無視する必要がある。
- 現在の `StudioScreen.test.tsx` は「中止ボタンを押せる」までしか検証せず、中止→即再生成→古いrejectの順序を覆っていない。

### [P1] 完了済みの選択タスクが集中セッションへ混入する

- `apps/desktop/src/screens/TasksScreen.tsx:66-67` はフッター表示だけ完了タスクを除外するが、選択ID自体は除去しない。
- `apps/desktop/src/state/LyraContext.tsx:243-245` の合計と、`:380-384` の `startFocus(selectedTaskIds, ...)` は未完了条件なしで全選択IDを使用する。
- 例: A/Bを選択→Aを完了→Bが残るためCTAは有効、の順で開始すると、UIはBだけの件数/合計を表示する一方、focus sessionにはA/B両方が送られる。Focus画面側も `apps/desktop/src/screens/FocusScreen.tsx:30` で完了状態を除外しない。
- 完了時に選択解除するか、集中開始時の未完了IDを単一のsource of truthとして表示・合計・`startFocus`へ渡す必要がある。

### [P1] ライブラリ検索の応答順序で曲一覧が恒久的に欠落する

- `apps/desktop/src/screens/LibraryScreen.tsx:185-191` は検索文字ごとに非同期 `setLibraryQuery` を発火する。
- `apps/desktop/src/state/LyraContext.tsx:403-407` はrequest revisionを持たず、返ってきた順に共有 `tracks` 全体を置換する。
- 「Rain」を入力後すぐ消すなど、古い絞り込み応答が最新の全件応答より後に返ると、検索欄は空なのに共有一覧は古い部分集合のままになる。以降、別のqueryを実行するまで欠落曲は戻らない。
- latest-request-winsのrevision、またはAbort/debounceを入れ、古い応答がstateへcommitしない回帰テストが必要。

### [P2] プレイヤーの「一時停止」が停止と選択解除を行う

- `apps/desktop/src/screens/LibraryScreen.tsx:272-279` の一時停止分岐は `stopMusic()` を呼ぶ。
- `apps/desktop/src/state/LyraContext.tsx:362` の `stopMusic` はAudioEngine停止に加え `selectedTrackId` とvariationを消す。そのためPauseアイコンを押しただけで「集中で使う」の選択まで解除され、真のpause/resumeにもなっていない。
- 一時停止は `AudioEngine.pause/resume` を公開した専用context操作へ分離し、停止ボタンだけが停止を行うべき。少なくとも選択曲を保持することをテストする。

### [P2] 主要な書き込み失敗が通知されず、入力だけ失われる

- タスク追加は `apps/desktop/src/screens/TasksScreen.tsx:91-97` でPromiseを待たずにフォームを消去し、rejectを処理しない。DBエラー時にタスクは追加されず、入力内容も復元されず、unhandled rejectionになる。
- 設定保存も `apps/desktop/src/screens/SettingsScreen.tsx:140-143,260` でrejectを処理せず、プリセット保存/削除、データフォルダ操作にも同じパターンがある。Focus終了 (`apps/desktop/src/screens/FocusScreen.tsx:107`) は成功確認前にDialogを閉じる。
- 書き込み中disable、成功後だけclear/close、失敗時Sonnerまたはinline Alert、再試行可能な入力保持が必要。現在のテストはすべてresolved Promiseのみで失敗経路を覆っていない。

### [P2] 1180px/900px向けのビジュアル仕様とトークン適用が一致していない

- `apps/desktop/src/styles.css:841,1018` は未定義の `--surface` を使うため、Settings/Focusのsurface背景指定が無効になる。`--card`または定義済みsemantic surface tokenへ揃える必要がある。
- 1180pxでは `@media (max-width:1199px)` によりタイマーが104px (`apps/desktop/src/styles.css:1232-1234`) となり、指定の132pxを満たさない。900pxだけ縮小するbreakpointへ分離すべき。
- 設定の二次ナビは通常248pxの指定に対し1180pxで180px (`:1223-1226`)、900pxで72pxアイコンrail (`:1247-1255`) になる。狭幅はTitle付きSheetへ移す仕様だが、Sheetが表示されるのは800px未満 (`:1274-1285`) で、アプリ最小幅900pxでは到達不能。
- 固定Library playerは正しく108px/Sidebarオフセット追従だが、`apps/desktop/src/screens/LibraryScreen.css:212` に影があり「影はDialogと中央オーブだけ」の制約から外れる。

### [P3] Canvas内にraw colorが残り、semantic tokenの一元管理から外れている

- `apps/desktop/src/components/music/MoodOrb.tsx:24-25,52,76,83,88` にhex/rgbaが直書きされている。カタログ由来の動的ムード色は妥当だが、背景・主文字・primaryはCSS custom propertyを `getComputedStyle` で取得するなどしてsemantic tokenへ接続できる。
- `space-x/y` の追加はなく、一覧行のカード化も確認されなかった。

## Responsive / accessibility audit

- Sidebar幅は `>=1280:252px / 1100-1279:220px / 900-1099:84px` を満たす。
- Library playerは108px固定で、3つのSidebar幅に応じてleft offsetが切り替わる。
- 画面実装のDialog/Sheet/AlertDialogにはすべてTitleがある。
- タスクDnDはPointer/Keyboard sensorとAlt+Arrowのフォールバックを持つ。Calendar/Command/Popoverもshadcn/Radix経由。
- 900×620ではFocus/Alchemyの縦方向実画面確認が必要。静的には短高breakpointがあるが、Alchemy workspaceにスクロール領域がなく、5 mood + draft/error状態のCTA可視性はテストされていない。
- Browser pluginは検出されたが、この実行環境では利用可能browserが0件だったため、1180×780/900×620のスクリーンショット比較とconsole確認は未実施。fidelity ledgerの「Final screenshot check」は未更新のままが正しい。

## Verification

- `bun run --cwd apps/desktop test` — PASS: 20 files / 111 tests
- `bun run --cwd apps/desktop typecheck` — PASS
- `bun run --cwd apps/desktop build` — PASS: 2931 modules（758.19kB chunk warningあり）
- `git diff --check` — PASS
- Browser rendered QA — BLOCKED: available browser 0

