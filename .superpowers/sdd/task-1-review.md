# Task 1 specification and quality review

## Verdict

CHANGES REQUESTED

本番bundleから`BrowserDevBridge`が除外され、unsupported browserで案内画面へ到達すること、およびPhase 0のスコープテスト28件が成功することは確認した。ただし、承認計画が明示するStrictMode／再試行の競合と、ブラウザ開発用タイマーに未解決の問題があるため、現状はAPPROVEDにできない。

## P0

該当なし。

## P1

### [P1] 古い起動リクエストが新しい起動状態を上書きできる

- File: `apps/desktop/src/state/LyraContext.tsx:101`
- Related: `apps/desktop/src/state/LyraContext.tsx:122`

`loadStartup`にはリクエスト世代番号またはeffect cleanupによる無効化がなく、`useEffect`もPromiseをfire-and-forgetしている。StrictModeでは最初のsetupが開始した取得をcleanupしてもキャンセルせず、2回目のsetupの取得が先に成功した後で、1回目の古い結果またはエラーが`tasks`、`tracks`、`timer`、`startupError`を上書きできる。再試行の連打でも同じ順序逆転が起こる。既存のStrictModeテストは購読解除回数しか検証しておらず、起動データの遅延解決を逆順にしても最新結果だけが反映されることを検証していない。承認計画の「StrictMode二重mount、購読解除、再試行を回帰テストする」を満たすには、古い取得を無効化し、逆順解決と古いrejectの回帰テストが必要。

### [P1] Event再接続が起動データ再読込と結合され、利用可能な画面を起動エラーへ落とせる

- File: `apps/desktop/src/state/LyraContext.tsx:124`
- Related: `apps/desktop/src/App.tsx:75`

購読エラーの「再接続」も`retryStartup`を呼び、購読試行番号を進めるだけでなく`loadStartup()`で全起動データを再取得して`ready=false`にする。したがって、Event購読だけが失敗して既存データで利用可能な状態でも、再接続中の`listTasks`等が一つ失敗すると`startupError`が立ち、`AppGate`が画面全体を起動失敗へ置き換える。また、成功しても不要な全件再読込でローカル状態を上書きする。これは「起動データ取得とイベント購読のエラーを分離する」という契約を操作経路では満たしていない。起動失敗用の再試行と購読専用の再接続を分け、購読再接続失敗時もreadyな画面を維持するテストが必要。現在の`App.test.tsx`は同じmock関数が呼ばれたことしか検証していないため、この退行を検出できない。

## P2

### [P2] BrowserDevBridgeの実行中タイマーが自動で進まない

- File: `apps/desktop/src/services/browserDev.ts:182`

ブラウザ用タイマーは`timerDispatch`が呼ばれた時だけ状態を更新・publishし、`start`後にdeadlineへ向けてtickを発行するschedulerを持たない。React側にもブラウザ開発用のtick dispatchはないため、`dev:ui`で「集中を始める」とstatusはrunningになるが、残り時間は25:00のまま止まる。計画はBrowserDevBridgeがタイマーとEvent購読をインメモリで提供するとしており、主要画面確認用ブリッジとしては不完全。fake clockで経過時間と購読解除後のscheduler停止を検証する回帰テストを追加すべき。

### [P2] E2EフラグだけでTauri E2Eと判定し、Tauri外E2E bundleをdesktopBridgeへ流す

- File: `apps/desktop/src/services/runtime.ts:13`
- Related: `apps/desktop/src/bootstrap.tsx:27`

`detectRuntime`は`e2e=true`を`tauriInternals`より先に無条件採用するため、`VITE_E2E=1`のbundleをTauri internalsなしで開いても`tauri-e2e`となり、plugin読込後に`desktopBridge`へ到達する。これは環境名の「Tauri E2E」と一致せず、E2E harnessのmock/globalがない場合はPhase 0で除去対象としたTauri APIエラーを再発させる。現テストは`e2e=true, tauriInternals=true`だけで、`e2e=true, tauriInternals=false`の境界を検証していない。Tauri internalsまたは明示的なE2E harness存在条件を要求し、境界テストを追加すべき。

## P3

### [P3] 本番bundle除外は手動確認だけで回帰テスト化されていない

- File: `apps/desktop/src/bootstrap.test.tsx:31`

unsupported browserのテストは直接runtime文字列を渡したjsdom実行であり、production buildに`BrowserDevBridge` chunk／固定曲文字列が混入しないことは検証しない。今回のbuild成果物では混入がないことを確認できたが、報告上の手動`rg`だけでは将来のimport条件変更を検出できない。tooling testまたはbuild後検査として、production artifactに`browser-dev://`や固定開発曲の識別子および専用chunkがないことを継続検証するのが望ましい。

## Verification performed

- `bunx vitest run --root . apps/desktop/src/services/runtime.test.ts apps/desktop/src/services/browserDev.test.ts apps/desktop/src/bootstrap.test.tsx apps/desktop/src/state/LyraContext.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/services/desktop.test.ts` — 6 files / 28 tests passed.
- `apps/desktop/dist`を検索し、`browser-dev://`、固定開発曲文字列、`BrowserDevBridge`識別子がないことを確認した。
- 同じ成果物に`デスクトップアプリから起動してください`が含まれることを確認した。
- 対象差分の`git diff --check`は成功した。

## Re-review

### Verdict

APPROVED

前回指摘した全項目が閉じたことを確認した。

- **P1 起動リクエストの順序逆転**: `startupGeneration`により、StrictMode cleanup、重複再試行、unmount後の古い成功・失敗が状態を更新できなくなった。新規テストはStrictModeの古い成功を逆順解決し、重複再試行の古いrejectも新しいready状態を壊さないことを直接検証している。
- **P1 Event再接続と起動データ再読込の結合**: `retrySubscriptions`が独立し、`AppGate`の再接続ボタンもこの経路だけを呼ぶ。再接続成功・再失敗の双方で`ready`維持と`listTasks`非再実行を検証している。
- **P2 BrowserDev timerの停止**: 購読者が存在するrunning中だけ250ms schedulerを稼働し、deadlineから残り時間を再計算する。集中完了の`awaiting_break`遷移と最後の購読解除によるinterval解放もテストされている。
- **P2 Tauri E2E境界**: `e2e && tauriInternals`だけを`tauri-e2e`とし、Tauri internalsなしのproduction／development境界をそれぞれテストしている。
- **P3 production bundle除外の回帰検査**: 実際のproduction-mode Vite buildを一時領域へ生成し、manifestとJS成果物に開発ブリッジ識別子がなく、案内文が残ることを自動検証している。

### Re-review verification

- `bunx vitest run --root . apps/desktop/src/services/runtime.test.ts apps/desktop/src/services/browserDev.test.ts apps/desktop/src/bootstrap.test.tsx apps/desktop/src/state/LyraContext.test.tsx apps/desktop/src/App.test.tsx apps/desktop/src/services/desktop.test.ts apps/desktop/viteConfig.test.ts` — 7 files / 37 tests passed.
- 修正箇所と新規テストを行単位で再確認し、前回指摘に関する残件はない。
