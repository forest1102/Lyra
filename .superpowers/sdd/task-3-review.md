# Task 3 specification and quality review

## Verdict

CHANGES REQUESTED

Phase 0 の起動世代ガード、購読専用再接続、StrictMode cleanup は維持されている。新しい IPC 名・通常の camelCase payload も Rust command と概ね一致し、AudioEngine の音量・クロスフェード適用は Deck を作り直さない。生成中止後の古い Draft、集中終了後の延期 Draft、診断用 AudioContext の close もテストで確認した。

ただし、タスク更新失敗後のローカル状態、ライブラリ検索の非同期順序、nullable な更新値の Rust 境界にデータ整合性を壊す問題が残るため APPROVED にはできない。

## P0

該当なし。

## P1

### [P1] 失敗した楽観的タスク更新がローカル状態へ残り続ける

- File: `apps/desktop/src/state/LyraContext.tsx:274`
- Related: `apps/desktop/src/state/LyraContext.tsx:100`, `apps/desktop/src/state/LyraContext.tsx:296`, `apps/desktop/src/state/LyraContext.tsx:305`, `apps/desktop/src/state/LyraContext.tsx:320`

`updateTask`、`reorderTasks`、`toggleTask`、`moveTask` は bridge の完了前に `setTasks` するが、command が失敗した場合の rollback または authoritative reload がない。さらに楽観値へクライアント時刻の `updatedAt` を入れ、poll 側はローカル時刻が新しい限り `mergePolledTasks` でローカルを優先する。このため、存在しないタグ／プロジェクト、SQLite failure などで Rust が拒否しても、画面は保存済みに見えたまま 1.5 秒 poll でも復旧せず、再起動まで DB と UI が不一致になる。Task 3 brief が要求した poll/local edit conflict の回帰テストも追加されていない。失敗時に事前 snapshot を復元するか authoritative data を再取得し、in-flight poll、成功、失敗の各順序を fake timer/deferred response で検証する必要がある。

### [P1] 古いライブラリ検索結果が新しい検索・改名・削除を上書きできる

- File: `apps/desktop/src/state/LyraContext.tsx:403`
- Related: `apps/desktop/src/state/LyraContext.tsx:408`, `apps/desktop/src/state/LyraContext.tsx:413`

`setLibraryQuery` は request generation を持たず、解決した順に `libraryQuery` と `tracks` を置き換える。例えば検索 A の応答を遅延させて検索 B を先に解決すると、最後に A が B の結果を上書きする。また、検索 A が実行中に曲を改名／削除し、A が古い snapshot を返すと、改名前タイトルや削除済み曲を `tracks` へ復活させる。Library UI はキー入力ごとにこの API を呼ぶため通常操作で発生する。最新 query だけを適用する世代ガードに加え、rename/delete で既存 query を無効化するか、mutation 後に現在 query を再取得する必要がある。逆順検索と検索中 mutation の回帰テストが必要。

### [P1] `null` によるタスク項目の解除が Tauri 境界で「未指定」になり更新できない

- File: `apps/desktop/src/domain.ts:53`
- Related: `apps/desktop/src/services/desktop.ts:87`, `crates/lyra-core/src/lib.rs:243`

TypeScript の `UpdateTask` は `projectId`、`plannedDate`、`dueDate`、`recurrence`、`estimatedPomodoros` を `null` にして解除できる契約で、BrowserDevBridge も JS の spread によりその通り解除する。一方 Rust はこれらを通常の `Option<Option<T>>` として derive Deserialize している。Serde の通常の `Option` deserializer では JSON の field missing と explicit `null` はどちらも外側の `None` になり、`Some(None)` を生成しないため、desktopBridge が `{ plannedDate: null }` を正しく送っても DB 更新では「変更なし」になる。double-option 用 deserializer／sentinel enum などで missing と null を区別し、実際の Tauri JSON payload で解除できる契約テストを追加する必要がある。

## P2

### [P2] TypeScript では省略可能な `sort` が Rust では必須になっている

- File: `apps/desktop/src/domain.ts:203`
- Related: `apps/desktop/src/services/desktop.ts:99`, `crates/lyra-core/src/lib.rs:701`

`MusicTrackListQuery.sort` は TypeScript と BrowserDevBridge では省略可能で、BrowserDev は省略時 `created_desc` を使う。しかし Rust の `MusicTrackListQuery.sort` には `#[serde(default)]` がないため、`listTracks({ query: "雨" })` は Tauri で missing field `sort` として deserialize に失敗する。現在の IPC テストは常に sort を含めるので不一致を検出しない。Rust 側で enum default を serde default として適用するか、TypeScript 側で必須に揃え、省略 payload の境界テストを追加すべき。

## P3

該当なし。

## Verified behavior without findings

- Phase 0 の startup generation guard、subscription-only retry、購読解除、production browser guard は保持されている。
- BrowserDev timer scheduler は最終 listener の解除で停止し、既存 Phase 0 テストも成功する。
- generation revision により cancel 後／後発生成後の古い Draft は `draft` を置き換えない。
- deferred Draft は focus-running 以外の timer Event 後に明示検証可能な `pending` へ移る。
- 再生中 ID を含む削除では delete command より先に AudioEngine を停止し、timer command は呼ばない。
- 設定の音量とクロスフェードは output/state へ適用され、Deck 再生成を伴わない。
- browser diagnostics は成功／Worklet failure の双方で検査用 AudioContext を close する。

## Verification performed

- `./node_modules/.bin/vitest run apps/desktop/src/services/desktop.test.ts apps/desktop/src/services/browserDev.test.ts apps/desktop/src/services/diagnostics.test.ts apps/desktop/src/state/LyraContext.test.tsx apps/desktop/src/services/musicGeneration.test.ts apps/desktop/src/services/audioEngine.test.ts` — 6 files / 53 tests passed.
- `bun run --cwd apps/desktop test` — 20 files / 111 tests passed.
- `bun run --cwd apps/desktop typecheck` — passed.
- `bun run --cwd apps/desktop build` — passed; Vite emitted the existing chunk-size warning only.

