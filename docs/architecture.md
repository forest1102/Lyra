# Lyra desktop architecture

## Runtime ownership

```text
React + Vite UI
  ├─ one-shot requests ─────────── Tauri commands ─┐
  ├─ timer state updates ───────── timer://state   │
  └─ music failure updates ─────── music://error   │
                                                   ▼
                                             Tauri Core (Rust)
                                                   │
                              ┌────────────────────┼───────────────┐
                              ▼                    ▼               ▼
                         lyra-core            Codex App       SC runtime
                         SQLite + timer        Server JSONL    OSC v1
```

`apps/desktop` is the only user-facing application. Rust owns the deadline timer, SQLite connection, Codex process, and SuperCollider process. The UI requests the initial state through Tauri commands and then treats Rust events as authoritative; it has no browser fallback or generated fixture state.

Closing the main window hides it without stopping the Rust runtime. Clicking the menu bar item restores the same window. The application identifier remains `app.lyra.focus`, so existing SQLite and generated track data continue to use the same Application Support directory.

The separate `lyra-mcp` executable remains an optional local integration. It writes to the same WAL-mode SQLite database, and the desktop UI polls tasks every 1.5 seconds to reflect MCP additions.

## SuperCollider data flow

```text
Codex JSON
  → metadata validation
  → Rust tokenizer / source-policy-v1
  → track-specific SynthDef namespace
  → sandbox-exec + validate.scd
  → muted five-second runtime check
  → managed .scd + SHA-256 + SQLite row

Deck A Group → stereo Bus A ┐
                             ├→ Trusted Mixer → LeakDC → Limiter(0.8) → Output
Deck B Group → stereo Bus B ┘
```

The standby deck begins muted. After 100 ms without a runtime error, the trusted mixer performs a two-second crossfade. Request IDs are monotonic; a stale switch response cannot replace the most recent selection.

## Failure policy

- Ping every two seconds.
- Three consecutive failures trigger a runtime restart.
- The first failure restores the same track and seed from the beginning.
- A second failure within five minutes disables BGM for that focus session.
- Timer state is a separate deadline-based Rust state machine and continues through every music failure.
- Quitting or reopening interrupts any session left in `running` state; interrupted sessions never increment the completed focus count.
