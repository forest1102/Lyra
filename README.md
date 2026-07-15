# Lyra

LyraはmacOS 15.4以降向けのローカルファースト集中支援アプリです。タスク、Pomodoroタイマー、Codexが生成する制約付きChucK BGMをTauriアプリにまとめています。

## 開発

必要なもの:

- macOS 15.4以降
- Bun 1.3.10
- Rust/Cargo（Nix利用時は`nix shell nixpkgs#cargo nixpkgs#rustc`）
- ローカルのCodex CLI

```sh
bun install --frozen-lockfile
bun run app:dev
```

検証:

```sh
bun run verify
nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test -p lyra-core -p lyra-desktop
bun run app:build
```

## Desktop E2E

Desktop E2EはmacOSの実WKWebView上でE2E専用debug Tauri binaryをWebdriverIOから操作します。画面遷移、モックIPC、SQLite永続化、無音集中の一時停止・再開・終了を検証します。

```sh
bun run test:e2e
bun run --cwd apps/desktop test:e2e -- --spec e2e/specs/mock-ipc.e2e.ts
bun run --cwd apps/desktop test:e2e -- --spec e2e/specs/backend.e2e.ts
```

各実行は一時的な`LYRA_E2E_DATA_DIR`を作成して終了時に削除します。失敗時のログとスクリーンショットは`apps/desktop/e2e/artifacts/`へ保存されます。

## 音声アーキテクチャ

生成結果は`chuckSource`を含む閉じたJSONとして受け取り、Rustで48KiB上限、UGen allowlist、seed、ループ、時間進行を静的検査します。クライアントは破棄可能なWebChucK VMで5秒検証し、合格したDraftだけをプレビュー・`.ck`保存できます。

再生はWebView内の単一`AudioContext`で行います。2つのWebChucK DeckをGainへ接続し、曲の切り替え時は2秒でクロスフェードします。最終段は安全リミッターから`AudioContext.destination`へ接続し、OSのシステムデフォルト出力に追従します。E2Eビルドでは最終ゲインを0にして実機へ音を出しません。

WebChucKは公式GitHubタグ`v1.2.11`をBun依存として固定しています。JS/WASM本体は`node_modules`からViteがビルド成果物へコピーし、起動時にSHA-256を検証するため、依存本体をGit管理せず実行時の外部ネットワーク取得も行いません。

## データ

SQLiteと生成された`.ck`は`app.lyra.focus`のApplication Support配下へ保存します。DB migration v3は旧音楽トラックを削除し、集中履歴から楽曲参照だけを外します。タスク、タイマープリセット、集中履歴は保持します。

外部サンプル、マイク入力、WebChugin、MIDI/HID/OSC、ファイル・ネットワークアクセス、自由プロンプト、生成コード編集、クラウド同期は対象外です。
