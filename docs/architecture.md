# Architecture

```text
React UI
  ├─ Tauri commands ── Rust timer / SQLite / Codex generation
  ├─ timer://state ─── Rust-authoritative timer state
  └─ AudioEngine ───── WebChucK AudioWorklet
                         ├─ Deck A ─┐
                         ├─ Deck B ─┼─ Gain → limiter → output Gain
                         └──────────┘              → AudioContext.destination
```

`apps/desktop`が唯一のUIです。Rustはタイマー、SQLite、Codex生成、ChucK静的ポリシー、保存ファイルのSHA-256整合性を担当します。クライアントは音声再生を担当し、再生状態は`AudioEngine`が正です。出力先はOSのシステムデフォルトに追従します。

## Generation flow

```text
controls → Codex App Server → closed JSON/chuckSource
         → Rust static policy（失敗時は同じthreadで修復1回）
         → disposable muted WebChucK VM / 5秒meter
         → Rust report confirmation
         → preview → managed .ck + SHA-256 + SQLite
```

ChucKソースは1〜4 voice、48KiB以下、固定UGen allowlist、`Math.srandom(__LYRA_SEED__)`を必須とします。外部I/O、動的評価、再帰、ネストしたループを拒否し、各voiceループは正の有限時間を1回だけ進めます。

## Audio output

WebChucK JS/WASMと検証用Workletはアプリへ同梱され、音声実行経路はローカルで完結します。通常ビルドはシステムデフォルトへ出力し、E2Eビルドは最終ゲインを0にします。
