# Lyra MVP architecture

## Runtime ownership

```text
Expo UI
  ├─ TaskRepository ───────────────┐
  ├─ TimerService ───────────────┐ │
  ├─ MusicGenerationService ───┐ │ │
  └─ MusicPlaybackService ───┐ │ │ │
                             ▼ ▼ ▼ ▼
                         Tauri commands
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
          lyra-core      Codex App      SC runtime
          SQLite         Server JSONL   OSC v1
```

Expo code depends only on the service boundary in `packages/domain`. A later iOS client can keep the UI and replace Tauri commands with an authenticated HTTP implementation.

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
