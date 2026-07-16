# Task 2 final Rust/backend review

## Verdict

CHANGES REQUESTED

初回レビューの主要項目（完了遷移の冪等化、月次anchor、focus完了の同一transaction化、tag更新、保存失敗時の補償、削除失敗時の復元、autostart補償、データフォルダcommand）は実装され、focused testとworkspace全体も成功した。ただし、削除journalのクラッシュ耐性と起動復旧、生成中止競合、設定・繰り返し更新の整合に未解決経路が残る。

## P0

該当なし。

## P1

### [P1] 「durable」delete journalと`.ck`確定renameが永続化されず、クラッシュでSQLiteと音源を再び不整合にできる

- File: `crates/lyra-core/src/lib.rs:1998`
- Related: `crates/lyra-core/src/lib.rs:2003`, `crates/lyra-core/src/lib.rs:1801`

削除journalは`std::fs::write`でcloseするだけで、journal fileにもquarantine directoryにも`sync_all`相当を行わないまま元音源をrenameしてSQLiteをcommitする。電源断・OS crash時にはrename/SQLite commitだけが残り、journalが欠落または0 byteになり得るため、DB行が残る場合でも元pathを復元できない。修正報告が保証している「durable per-operation journal」にはなっていない。同様に新規保存はpending file本体だけを`sync_all`し、final pathへのrename後に親directoryを同期せずSQLiteをcommitするため、再起動後にDB行だけ残り`.ck`がpending名または欠落になる窓がある。journal fileと必要なdirectory metadataをSQLite commit前に永続化し、crash pointごとの再起動回復テストが必要。

### [P1] cleanup失敗で残したjournalなしdirectoryを、次回起動時に致命的な復旧エラーとして扱う

- File: `crates/lyra-core/src/lib.rs:1982`
- Related: `crates/lyra-core/src/lib.rs:1998`, `crates/lyra-core/src/lib.rs:2084`, `apps/desktop/src-tauri/src/lib.rs:46`

対象ID不明・SHA不一致・journal書込失敗などでは、既に作成したoperation directoryの`purge`失敗を捨てて元エラーだけを返す。そのdirectoryには`journal.json`がないかpartial fileしかない。その後の`recover_music_delete_quarantine`は全subdirectoryへ完全なjournalがある前提で即read/deserializeし、setup側が`?`で伝播するため、一時的なcleanup失敗一度でLyraが以後起動不能になる。journal未作成のoperationを識別できる状態機械、または安全に隔離して診断を返す回復方針が必要。missing/partial/unknown entryが他の正常journalの復旧も止めない回帰テストも必要。

## P2

### [P2] `update_task`でタグ変更と繰り返し完了を同時に行うと、次回タスクへ古いタグが複製される

- File: `crates/lyra-core/src/lib.rs:1326`
- Related: `crates/lyra-core/src/lib.rs:1144`

`update_task`は完了遷移を先に呼び、その中で現行`task_tags`を次回タスクへcopyした後、元タスクのタグを`tagIds`へ置換する。したがって`{status: "completed", tagIds: [new]}`はatomicにはcommitされるものの、生成された次回分だけ旧タグのままになる。tag置換を完了遷移より先に行うか、transition helperへ確定済みタグを渡し、同時更新を固定するテストが必要。

### [P2] defaultに指定したcustom presetを削除でき、保存設定が直後にvalidation不能になる

- File: `crates/lyra-core/src/lib.rs:1495`
- Related: `crates/lyra-core/src/lib.rs:1552`, `apps/desktop/src-tauri/src/lib.rs:50`

`delete_timer_preset`はbuilt-inかだけを確認し、`app.settings.v1.defaultPresetId`がそのcustom presetを参照していても削除する。再起動時だけは`standard`へ一時fallbackするが、JSON内のdefault IDは削除済みのままで、同じ設定を次に保存すると`validate_app_settings`が拒否する。削除時にdefaultを`standard`へ同一transactionで戻すか、default presetの削除を拒否する必要がある。

### [P2] Codex完了通知とキャンセルの競合で、キャンセル後の古いDraftを登録できる

- File: `apps/desktop/src-tauri/src/music/codex_client.rs:255`
- Related: `apps/desktop/src-tauri/src/commands.rs:515`, `apps/desktop/src-tauri/src/commands.rs:522`

キャンセルflagは各受信loopの先頭だけで確認される。`turn/completed`を受け取った直後から`generate_music_blocking`がdraft mapへinsertするまで再確認がないため、この窓で`cancel_music_generation`が走ると、ユーザーには中止済みなのに古いDraftが成功応答として到着する。承認計画の重点監査項目そのものだが、現行testは応答待ち中の取消しか覆っていない。request generation/tokenまたはinsert直前の取消確認でstale responseを破棄する競合テストが必要。

## P3

該当なし。

## Confirmed fixes and contracts

- v3 fixtureからv4/v5が同一migration transactionで適用され、v5失敗時はv4もrollbackする。
- 既存Today/Backlog/completed変換、親子曲とfocus/settings保持、再open、`ON DELETE SET NULL`を確認した。
- 通常・update・focusの完了は未完了からの一度だけ次回分を作り、月次anchorは`1/31 -> 2/28 -> 3/31`を保持する。
- `UpdateTask.tagIds`はomit/replace/clearを区別し、失敗時はtask metadataもrollbackする。
- recipe version、1〜5件、既知ID、重複、finite/positive weight、正規化、6種family、promptへのtempo/timbre/vector反映を確認した。
- `.ck`保存の通常DB/file失敗補償、削除のpartial move/restore failure/SQLite rejection/purge debt、SHA/path/symlink境界は現在のfault injection test範囲で成功する。
- settings validation後のautostart変更、DB失敗時のOS rollback、CloseRequestedの保存設定参照、default preset/auto break/notification、`open_data_directory`、invoke command名とTypeScript bridge名は整合している。
- SuperCollider runtime/diagnosticは再導入されていない。

## Verification performed

- `nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test -p lyra-core --test refresh -- --nocapture` — 18/18 passed.
- `nix shell nixpkgs#cargo nixpkgs#rustc -c cargo test --workspace` — 全Rust test passed。Codex live test 1件は認証・network必須のため既定どおりignored。
- `nix shell nixpkgs#cargo nixpkgs#rustfmt -c cargo fmt --all -- --check` — passed.
- `git diff --check -- Cargo.lock apps/desktop/src-tauri crates/lyra-core crates/lyra-mcp apps/desktop/shared` — passed.

コード変更は行っていない。
