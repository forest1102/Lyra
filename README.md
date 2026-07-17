# Lyra

LyraはmacOS 15.4以降向けのローカルファースト集中支援アプリです。タスク、Pomodoroタイマー、Codexが生成する制約付きChucK BGMをひとつのアプリにまとめています。

![LyraのMusic Alchemyでムードを調合して集中用BGMを生成するデモ](docs/assets/lyra-music-alchemy.gif)

## 主な機能

### Music Alchemy

- 最大5つのムードを選び、それぞれの比重を調整してブレンドできます。
- レシピをもとにCodexが制約付きChucKを生成します。Rustの静的ポリシーに合格しなかった場合は、同じ生成スレッドで1回だけ修復します。
- 破棄可能でミュートされたWebChucK VMによる5秒間の音声検証を通過したDraftだけを、プレビューして`.ck`として保存できます。保存した曲はライブラリで管理・再生できます。

### タスクと集中

- Today、Inbox、Upcoming、Completedのビューに加え、プロジェクトとタグでタスクを整理できます。
- 1階層のサブタスク、予定日と期限、毎日・毎週・毎月の繰り返し、優先度、Pomodoro見積もりに対応しています。
- 取り組むタスクを選び、PomodoroタイマーとBGMを使った集中セッションを記録できます。

### ローカル保存と再生

- タスクや集中履歴などはSQLite、生成した音楽はアプリが管理する`.ck`ファイルとしてローカルに保存します。
- 保存した音楽ソースはSHA-256で整合性を確認します。
- 音声はmacOSのシステムデフォルト出力へ再生します。

## Codex MCP連携

Lyraには、CodexからローカルのTodayまたはBacklogへタスクを追加するMCPサーバーが含まれます。まずリポジトリのルートでビルドします。

```sh
bun run mcp:build
```

生成されるバイナリは`target/debug/lyra-mcp`です。絶対パスを使ってCodexへ登録し、登録結果を確認します。

```sh
codex mcp add lyra -- /absolute/path/to/Lyra/target/debug/lyra-mcp
codex mcp list
```

同じホスト上のCodex App、CLI、IDE拡張はMCP設定を共有します。セットアップ後は、利用するCodex App、CLI、IDE拡張を再起動してください。詳しくは[CodexのMCPドキュメント](https://learn.chatgpt.com/docs/extend/mcp)を参照してください。

たとえば、Codexへ次のように依頼できます。

```text
LyraのTodayに「READMEを仕上げる」を2ポモドーロで追加して
Lyraに「次のリリースを計画する」をBacklogへ追加して
```

MCPが公開する`add_task`は、タイトルと追加先に加え、Pomodoro見積もり、優先度、プロジェクト、親タスク、メモ、予定日・期限、繰り返し、タグを任意で指定できます。MCP経由の一覧取得、編集、完了、削除は公開していません。

## 開発

### 必要な環境

- macOS 15.4以降
- Bun 1.3.10
- Rust/Cargo（Nix利用時は`nix shell nixpkgs#cargo nixpkgs#rustc`）
- ローカルのCodex CLI

### セットアップ

```sh
bun install --frozen-lockfile
```

### 起動

```sh
bun run app:dev
```

### 検証

```sh
bun run verify
nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test -p lyra-core -p lyra-desktop
bun run app:build
```

Desktop E2EはmacOSの実WKWebView上でE2E専用debug Tauri binaryをWebdriverIOから操作します。全体または個別specを実行できます。

```sh
bun run test:e2e
bun run --cwd apps/desktop test:e2e -- --spec e2e/specs/mock-ipc.e2e.ts
bun run --cwd apps/desktop test:e2e -- --spec e2e/specs/backend.e2e.ts
```

各実行は一時的な`LYRA_E2E_DATA_DIR`を作成して終了時に削除します。失敗時のログとスクリーンショットは`apps/desktop/e2e/artifacts/`へ保存されます。

## アーキテクチャとデータ境界

詳細は[アーキテクチャ資料](docs/architecture.md)を参照してください。

音楽生成は、ムードのレシピをCodex App Serverへ渡し、閉じたJSONの`chuckSource`を受け取ります。Rustが48KiB上限、UGen allowlist、seed、ループ、時間進行を静的検査し、必要なら1回だけ修復した後、クライアントが破棄可能でミュートされたWebChucK VMで5秒間検証します。合格したDraftだけをプレビューし、管理対象の`.ck`、SHA-256、SQLiteレコードとして保存します。

SQLiteと生成した`.ck`は`app.lyra.focus`のApplication Support配下へ保存します。WebChucK JS/WASMと検証用Workletはアプリに同梱され、固定されたWebChucK JS/WASMアセットはViteのビルド設定でSHA-256を検証するため、音声実行時にこれらを外部ネットワークから取得しません。通常ビルドはシステムデフォルトへ出力し、E2Eビルドは最終ゲインを0にします。

外部サンプル、マイク入力、WebChugin、MIDI/HID/OSC、ファイル・ネットワークアクセス、自由プロンプト、生成コード編集、クラウド同期は対象外です。
