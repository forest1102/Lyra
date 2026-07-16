# Task 2 specification and quality review

## Verdict

CHANGES REQUESTED

v3実DB相当からのv4/v5連続migration、既存Task/MCP入力、ムードカタログ30件、レシピ正規化、親曲`ON DELETE SET NULL`、Tauri handler登録は確認できた。focused 10件とRust workspace全体も成功した。ただし、`.ck`削除・保存とSQLiteの一貫性、autostartと保存設定の一貫性、繰り返しタスクの完了契約にデータ損失または重複を起こす経路が残るためAPPROVEDにはできない。

## P0

該当なし。

## P1

### [P1] quarantine復元失敗を無視して唯一の`.ck`を削除し得る

- File: `crates/lyra-core/src/lib.rs:1775`
- Related: `crates/lyra-core/src/lib.rs:1821`, `crates/lyra-core/src/lib.rs:1933`

prepareまたはSQLite transactionが失敗した場合、`restore_quarantined`は各`rename`の失敗を捨て、その直後にquarantineを`remove_dir_all`している。元パスが再作成された、権限が変わった、ファイルシステム障害が起きた等で復元に失敗すると、DB行は残ったままquarantine側の唯一の音源まで消す。さらにDB commit後の`remove_dir_all`失敗は、DB行が削除済みなのにcommandを`Err`で返し、再試行もできない半成功状態になる。復元は結果を返して、全件復元を検証できるまでquarantineを消してはいけない。commit後purgeは成功レスポンスと矛盾しない回復方針（起動時に回収する永続journal等）を持たせ、prepare中のfile failure、restore failure、purge failureを個別に回帰テストする必要がある。

### [P1] 設定validation/DB失敗の前にOS autostartを変更している

- File: `apps/desktop/src-tauri/src/commands.rs:322`
- Related: `crates/lyra-core/src/lib.rs:1431`

`save_app_settings`は最初に`enable/disable`し、その後で初めて`Database::save_app_settings`のversion、volume、crossfade、default preset検証と永続化を行う。例えば存在しないdefault presetと`launchAtLogin=true`を渡すとcommandは失敗するが、OS側だけ有効になる。DB書込失敗でも同じ不整合になる。先に副作用なしのvalidationを行い、OS変更とDB更新の片方が失敗した際に旧状態へ補償する必要がある。現在このcommand経路にはテストがない。

### [P1] 繰り返しタスクの完了が非冪等で、完了経路によって次回分が欠落・重複する

- File: `crates/lyra-core/src/lib.rs:1050`
- Related: `crates/lyra-core/src/lib.rs:1186`, `crates/lyra-core/src/lib.rs:1514`

`set_task_completed(id, true)`は現在値を確認せず、既にcompletedの行へ再実行しても毎回新しい次回タスクをINSERTする。`complete_focus_session`もrunning sessionを更新できた件数を確認せず、focus完了を先にcommitした後でこの関数を呼ぶため、IPC再試行で次回分が重複し、後段失敗時はfocus/taskだけcompletedで次回分がない状態になる。一方、公開`update_task`でstatusをcompletedへ変えた場合は次回分を一切作らない。また`AddTaskV2`はinboxのrecurrenceにplanned/dueの両方がない入力を許し、そのタスクは完了できない。完了遷移を一つのtransactional helperへ集約し、未完了→完了の一度だけ次回分を作成し、すべての完了経路を通す必要がある。

### [P1] 曲保存がfile先行・無補償でSQLite失敗時に孤立`.ck`を残す

- File: `crates/lyra-core/src/lib.rs:1593`
- Related: `apps/desktop/src-tauri/src/commands.rs:483`

`save_music_track`は`.ck`を書いた後にSQLite INSERTし、未知のparent FK、DB lock/disk-full等でINSERTが失敗してもファイルを削除または隔離しない。さらに`save_music_draft`は保存前にdraft mapからremoveするため、同じ失敗でdraftも失われる。計画の重点監査対象である「SQLiteと`.ck`の不整合」を新規保存側で残している。temp/quarantineへの書込、DB transaction、最終renameを補償可能な順序で行い、DB failure/file failureの双方でDB・ファイル・draftが元状態に戻るテストが必要。

### [P1] 設定画面の「データフォルダを開く」を実現するcommand/plugin配線がない

- File: `apps/desktop/src-tauri/src/lib.rs:65`

handlerにはsettings取得・保存・診断は登録されたが、承認計画のデータ操作「データフォルダを開く」に対応するcommandもTauri opener pluginも存在しない。フロントから安全にOSへデータディレクトリを開かせる公開契約を追加し、実際の`NativePaths::data_directory`以外を指定できない形で配線する必要がある。

## P2

### [P2] `UpdateTask`では既存タスクのタグを変更できない

- File: `crates/lyra-core/src/lib.rs:234`
- Related: `crates/lyra-core/src/lib.rs:1186`

作成時は`tagIds`を受け取るが、`UpdateTask`にタグ指定がなく、更新処理も`task_tags`を触らない。そのため承認UIのプロジェクト・タグ検索で既存タスクへタグを追加・削除できない。`Option<Vec<String>>`等で「変更なし」と「空にする」を区別し、task更新とjoin table置換を同一transactionにする必要がある。

### [P2] 月末へ丸めた月次タスクが翌月以降に元の日付へ戻らない

- File: `crates/lyra-core/src/lib.rs:141`
- Related: `crates/lyra-core/src/lib.rs:1078`

1月31日→2月28日はテスト済みだが、生成された2月28日を基準に次を計算すると3月28日になり、31日基準が失われる。「該当日がない場合は月末へ丸める」を継続的な月次予定として扱うなら、1/31→2/28→3/31を保つanchor day（または月末指定）が必要。少なくとも複数回完了する回帰テストで期待仕様を固定すべき。

### [P2] migration/deleteの失敗境界テストが要求範囲を覆っていない

- File: `crates/lyra-core/tests/refresh.rs:33`
- Related: `crates/lyra-core/tests/refresh.rs:154`, `crates/lyra-core/tests/refresh.rs:306`

v3 fixtureは親子曲、focus history、既存settingsを含まず、migration後の再open（再実行）やv4成功後・v5失敗時のrollbackを検証していない。削除はSHA mismatchとDB trigger rollbackを検証する一方、複数ファイルの途中move失敗、復元rename失敗、commit後purge失敗、data-dir外/symlink境界を検証していない。今回の最重要データ保護契約なので、これらを直接故障注入できるfilesystem abstractionまたは限定的test hookで固定すべき。

## P3

該当なし。

## Confirmed contracts

- v3相当fixtureからv4/v5が同一transaction内で適用され、既存Today/Backlog/completed変換とlegacy recipe付与が成功する。
- migration日のplannedDateはSQLite `date('now', 'localtime')`で`YYYY-MM-DD`として保存される。
- `MusicRecipeV1::resolve`はversion、1〜5件、既知ID、重複、finiteかつ`0 < weight <= 1`を検査し、合計で正規化して8 vectorsと6種のstructure familyを解決する。
- mood catalogはversion 1、5分類×6件である。
- v5の新規self FKは`ON DELETE SET NULL`で、手動SQLite検査でも既存parent/childコピー後の`foreign_key_check`は空だった。
- MCP `add_task`は従来のrequired `title/list`とoptional `estimatedPomodoros`を保ち、新規フィールドをすべてoptional/default付きで受ける。
- 新規Tauri commandsは`generate_handler!`へ登録されている（上記データフォルダ操作を除く）。

## Verification performed

- `nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test -p lyra-core --test refresh -- --nocapture` — 10/10 passed.
- `nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test --workspace` — 全Rust test passed、Codex live test 1件は認証・network必須のため既定どおりignored。
- `nix shell nixpkgs#cargo nixpkgs#rustfmt -c cargo fmt --all -- --check` — passed.
- SQLite 3.51.0でparent/childを含むv4相当`music_tracks`をrename→v5 schemaへcopy→旧table dropし、`PRAGMA foreign_key_check`が空、childのparent参照が維持されることを確認した。
