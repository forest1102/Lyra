# 画面遷移中の音楽生成継続 設計

## 目的

Music Alchemyで開始した音楽生成を、集中・タスク・ライブラリ・設定へ移動しても継続する。生成中の状態はSidebarから確認でき、別画面で完成した場合は全画面共通の通知からMusic Alchemyへ戻れるようにする。

## 現状と根本原因

生成コマンドとDraftは`LyraContext`で管理されている一方、レシピ、生成フェーズ、中止状態、修復履歴、エラー、進捗コールバックの有効性判定は`StudioScreen`のローカルstateにある。

`App`は選択画面だけをマウントするため、Music Alchemyから別画面へ移動すると`StudioScreen`がアンマウントされる。RustまたはBrowserDevBridgeの処理は継続しても、画面固有の進捗stateが破棄され、再訪時に`idle`へ戻る。その結果、実際の生成ジョブとUIの表示が一致しない。

## 採用方針

生成ジョブのライフサイクルを`LyraContext`へ移す。画面は共有状態を表示し、生成開始・中止・音声検証などの操作をContextへ依頼するだけにする。

Music Alchemyを非表示で常時マウントする方式は採用しない。見えないCanvasアニメーションと画面固有処理が動き続け、画面の寿命とジョブの寿命が結合したままになるためである。Rustへ永続ジョブAPIを追加する方式も、アプリ再起動をまたぐ生成継続を今回の範囲に含めないため採用しない。

## 状態モデル

`LyraContext`は次の生成セッション状態を公開する。

- `recipe`: 現在のムードレシピ
- `phase`: `idle / composing / source_validating / repairing / ready / audio / deferred / completed / failed`
- `generating`: 作曲・静的検査・修復中か
- `cancelling`: 中止要求の応答待ちか
- `repairReceived`: 現在の生成で修復工程が発生したか
- `generationError`: 生成または音声検証の表示用エラー
- `generationSessionId`: 古い進捗と古い完了結果を除外する単調増加ID

既存の`draft`と`musicPlayback`はそのまま共有状態として利用する。`StudioScreen`のカテゴリー選択だけは生成ジョブに影響しないためローカルstateに残す。

共有Contextはレシピ更新、生成開始、中止、Draftの音声検証、破棄に必要な操作を提供する。生成中または中止中のレシピ編集ロックも共有状態から導出する。

## データフロー

### 生成開始

1. Music AlchemyがContextの生成開始操作を呼ぶ。
2. Contextが現在のレシピを正規化し、セッションIDを更新する。
3. Contextが`runMusicGeneration`を開始し、進捗を共有`phase`へ反映する。
4. `StudioScreen`がアンマウントされてもContextは維持されるため、ジョブと進捗更新は継続する。
5. 完了結果は既存の`generateTrack`経由で`draft`へ保存され、`phase`は`ready`または`deferred`になる。

### 中止

中止はMusic Alchemyの「生成を中止」を押した場合だけ実行する。画面遷移、Sidebar操作、タイマー操作では中止しない。

中止開始時にセッションIDを更新して古い進捗を無効化する。Bridgeの中止が成功したら`idle`へ戻し、失敗した場合は`failed`とエラーを保持する。既存のgeneration revision保護も維持し、ContextとBridgeの両境界で古いDraftを破棄する。

### 画面復帰

Music Alchemyへ戻った時は、共有Contextのレシピ、フェーズ、エラー、Draftをそのまま表示する。画面のマウント時に生成状態を初期化しない。

## Sidebarと完了通知

SidebarのMusic Alchemy項目は、`generating`または`cancelling`の間だけ小さなSpinnerと「生成中」を表示する。ナビゲーション操作は通常どおり可能で、表示は状態確認のみに使う。

Music Alchemy以外の画面を表示している間に生成が成功した場合、Sonnerで「音楽が完成しました」というToastを1回だけ出す。Toastのアクション「確認する」はMusic Alchemyへ遷移する。

Music Alchemyを表示中に完成した場合は、画面内ですぐ結果を確認できるため完了Toastを出さない。失敗時は既存どおりMusic Alchemy内へエラーを保持し、別画面では「音楽の生成に失敗しました」というToastを1回表示する。画面遷移だけでは通知を重複させない。

## コンポーネント境界

- `LyraContext`: 生成セッションの唯一の状態所有者。生成・中止・進捗・エラーを管理する。
- `StudioScreen`: 共有状態を表示し、ムード操作と生成操作をContextへ委譲する。
- `App`: 現在の画面IDを把握し、生成完了・失敗の遷移を監視して画面外Toastを出す。
- `AppSidebar`: 生成中かどうかをpropsで受け取り、Music Alchemy項目へ状態表示を付ける。
- `runMusicGeneration`、DesktopBridge、Rust生成サービス: 契約を変更しない。

`App`は生成結果の通知だけを担当し、生成ジョブ自体を開始・中止しない。これにより画面遷移と生成処理の責務を分離する。

## エラーと競合

- 中止直後に届いた古い進捗とDraftはセッションIDおよび既存revisionで無視する。
- 生成中に再度生成を開始する操作はUIロックで防ぐ。
- Contextがアンマウントされるアプリ終了時は、今回の設計では生成を永続化しない。
- StrictModeの二重マウントでも生成開始はイベントハンドラからのみ行い、Effectから自動開始しない。
- Toast監視は生成セッションIDごとに通知済みIDを保持し、再レンダーや画面往復で重複通知しない。
- 音声検証中に別画面へ移動した場合も共有`audio`フェーズを維持する。ブラウザのユーザー操作制約上、音声検証の開始自体はMusic Alchemy上の明示クリックを維持する。

## テスト

### Context

- 生成開始後にConsumerをアンマウントしても進捗とDraftが更新される。
- 新しいConsumerをマウントすると現在の生成フェーズとレシピを取得できる。
- 中止時だけBridgeの中止コマンドが呼ばれる。
- 中止後の古い進捗・古いDraftが状態を更新しない。
- 修復工程と失敗状態が画面遷移後も維持される。

### AppとSidebar

- 別画面への遷移で生成中状態が維持される。
- 生成中だけMusic Alchemy項目へSpinnerと「生成中」が表示される。
- 別画面での成功・失敗時だけToastが1回表示される。
- ToastのアクションでMusic Alchemyへ移動する。
- Music Alchemy表示中の成功では完了Toastを出さない。

### StudioScreen

- 再マウント時に共有フェーズ、レシピ、Draftを表示する。
- 生成中と中止中はムード編集がロックされる。
- 明示中止ボタン以外のアンマウントでは中止コマンドを呼ばない。

### QA

- `dev:ui`で生成開始後に全4画面を移動し、Sidebar表示と生成継続を確認する。
- 別画面で完成させ、ToastからMusic Alchemyへ戻ってDraftを確認する。
- 1180×780と900×620でSidebar表示がレイアウトを壊さないことを確認する。
- 最終的にフロントテスト、型検査、`bun run verify`、`bun run app:build`を実行する。

## 対象外

- アプリ終了・再起動後の生成再開
- 複数生成ジョブの同時実行やキュー
- OS通知による完了通知
- Sidebarからの生成中止
- 生成中の仮音源または自動再生
