# Lyra

Lyra is a local-first focus companion for macOS. It combines multi-task Pomodoro sessions with constrained, Codex-generated SuperCollider soundscapes.

## MVP features

- Focus: Sprint 15/3, Standard 25/5, Deep Focus 50/10, and saved custom presets
- Tasks: Today/Backlog, estimated Pomodoros, completion, and multi-task focus sessions
- BGM Studio: four themes, ambient/Lo-fi/minimal-melody arrangements, and brightness, density, and motion controls
- Library: generated tracks, good/poor rating, favorites, read-only SC source metadata, and saved variations
- Live music switching: original seed, variation seed, or silence without stopping the timer
- Desktop runtime: Rust-owned deadline timer, menu bar countdown, notification, SQLite, and close-to-menu-bar behavior
- Codex integration: App Server generation and a local STDIO MCP `add_task` tool

The BGM Studio and Focus flows are intentionally separate. Generation never happens from Focus; Focus only plays and switches saved tracks.

## Repository layout

```text
apps/client                 Expo Router + React Native Web UI
apps/desktop                Tauri package and desktop scripts
apps/desktop/src-tauri      Rust commands and SuperCollider runtime
packages/domain             Shared TypeScript types and state machines
crates/lyra-core            SQLite repositories and Rust timer
crates/lyra-mcp             STDIO MCP server for add_task
scripts/check-supercollider.sh
scripts/build-supercollider-headless.sh
```

## Prerequisites

- Bun 1.3.10
- Rust stable (`cargo` and `rustc`); Nix can provide it if it is not installed globally
- Codex CLI 0.139+ installed and authenticated
- SuperCollider 3.14.1 installed at `/Applications/SuperCollider.app`

Install JavaScript dependencies:

```sh
bun install
```

## Development

Run the Expo web UI:

```sh
bunx turbo run dev --filter=@lyra/client
```

Run the Tauri desktop app when Rust is installed globally:

```sh
bunx turbo run dev --filter=@lyra/desktop
```

With Nix-provided Rust:

```sh
nix shell nixpkgs#cargo nixpkgs#rustc -c bunx turbo run dev --filter=@lyra/desktop
```

The app stores SQLite and generated `.scd` files under the macOS application data directory for `app.lyra.focus`. Closing the main window hides it; the Rust timer and music runtime continue. Quitting marks running focus sessions as interrupted.

## Music generation quality contract

The generation prompt treats a theme as timbre and space, while the arrangement controls musical structure. Ambient is the default; saved tracks and variations retain the selected arrangement.

Every Codex generation turn receives the same structured musical contract plus only the recipe for the selected arrangement and theme. Unselected recipes are omitted so their tempo, instrumentation, and texture guidance cannot conflict. The common contract asks for a major or major-pentatonic tonal center, a mid-register lead, consonant harmony, bounded layer amplitudes, separated spectral roles, gentle envelopes, and predictable phrases. It explicitly rejects sub-bass drones, semitone clusters, tritones, alarm-like repetition, fast rough modulation, abrupt stereo motion, and unconstrained pitch randomness.

Subtle 1/f-like motion is expressed as bounded, multi-timescale control drift rather than as audible pink noise: slow `LFNoise1` layers may vary amplitude, filtering, pan, and phrase timing within narrow limits, but never pitch or harmony. This is an approximation for avoiding mechanical repetition, not a claim of a medical or universal relaxation effect.

Automated tests lock the prompt sections and numeric constraints so they cannot silently regress. They guarantee that Codex receives the quality instructions; they do not measure perceived quality, loudness, or the actual spectrum of a generated track.

## SuperCollider compatibility gate

Run this before BGM generation or playback work:

```sh
bunx turbo run check:supercollider --filter=@lyra/native-tooling
```

The gate performs `sclang start → scsynth boot → 440 Hz for two seconds → clean shutdown`. On the current macOS 26.5.2 development machine, the universal SuperCollider 3.14.1 `sclang` aborts before language startup with:

```text
Incompatible processor. This Qt build requires the following features:
    neon
```

Build and install the tested arm64 headless language runtime with:

```sh
bunx turbo run build:supercollider --filter=@lyra/native-tooling
```

Lyra automatically prefers that runtime from its application-data directory while continuing to use the official app's arm64 `scsynth` and standard plugins. `LYRA_SCLANG_PATH`, `LYRA_SCSYNTH_PATH`, and `LYRA_SC_PLUGIN_PATH` can override all three paths. The compatibility gate can be pointed at a custom runtime with `SCLANG`, `SCSYNTH`, or `SC_APP`.

The headless fallback has passed `sclang start → scsynth boot → 440 Hz for two seconds → clean shutdown` on this machine. The official Qt-enabled `sclang` still fails with the NEON error above.

Generated code goes through these gates before it can be saved:

1. JSON metadata and 48 KiB source limit
2. Token-based Class, selector, Symbol, and side-effect policy
3. Five-second isolated `sclang` validation for SynthDef size and 256 Pattern events
4. Five-second muted runtime validation for CPU, peak CPU, and Node limits

Generation during an active focus stops before audio validation and resumes only after focus ends.

## Codex App Server

Lyra starts one local `codex app-server` process on first generation. Each track uses a new thread with:

- read-only sandbox
- network disabled
- approval policy `never`
- fixed JSON output schema
- 120-second timeout
- one repair turn in the same thread after validation failure

Codex authentication remains owned by the separately installed Codex CLI. Lyra does not store API keys.

## MCP task tool

Build the server:

```sh
nix shell nixpkgs#cargo -c bunx turbo run build:mcp --filter=@lyra/native-tooling
```

Register the resulting executable in Codex configuration, replacing the paths with the local checkout and Lyra database location:

```toml
[mcp_servers.lyra]
command = "/absolute/path/to/Lyra/target/debug/lyra-mcp"

[mcp_servers.lyra.env]
LYRA_DB_PATH = "/Users/you/Library/Application Support/app.lyra.focus/lyra.db"
```

The server exposes only:

```ts
add_task({
  title: string,
  list: "today" | "backlog",
  estimatedPomodoros?: number
})
```

The desktop UI polls the shared WAL-mode database every 1.5 seconds, keeping MCP additions within the two-second reflection target.

## Verification

```sh
bun install --frozen-lockfile
nix shell nixpkgs#cargo nixpkgs#rustfmt -c bunx turbo run test typecheck build check fmt:check
nix shell nixpkgs#cargo nixpkgs#rustc -c bunx turbo run build:desktop --filter=@lyra/desktop
SCLANG=/path/to/headless/sclang bunx turbo run check:supercollider --filter=@lyra/native-tooling
nix shell nixpkgs#cargo -c bunx turbo run check:runtime --filter=@lyra/native-tooling
nix shell nixpkgs#cargo -c bunx turbo run check:generation --filter=@lyra/native-tooling
```

On macOS 26.5.2, run `bunx turbo run build:supercollider --filter=@lyra/native-tooling` first and then point the gate at the installed headless binary if Lyra has not yet discovered it. The short audio gate passes; long-running real-audio endurance checks—50-minute focus, 100 pause/resume cycles, process-kill recovery, and the 4 themes × 3 tracks human listening score—remain release QA.

## Security boundary

The MVP never accepts free-form SuperCollider prompts, samples, microphone input, Quarks, user Extensions, or additional UGen plugins. The allowlist reduces risk but is not treated as a complete security boundary. A public/iOS server version should move to a declarative music representation or stronger process isolation.
