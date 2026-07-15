# Lyra

Lyra is a local-first desktop focus companion for macOS 15 and later. It combines multi-task Pomodoro sessions with constrained, Codex-generated SuperCollider soundscapes.

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
apps/desktop/src            React + Vite desktop UI
apps/desktop/src-tauri      Tauri commands and SuperCollider runtime
crates/lyra-core            SQLite repositories and Rust timer
crates/lyra-mcp             STDIO MCP server for add_task
scripts/check-supercollider.sh
scripts/build-supercollider-headless.sh
```

## Prerequisites

- Bun 1.3.10
- Rust 1.96.1 (`cargo`, `rustc`, and `rustfmt`)
- Codex CLI 0.139+ installed and authenticated
- SuperCollider 3.14.1 installed at `/Applications/SuperCollider.app`
- Xcode Command Line Tools

### Install with Nix

Use Nix only to install the native development tools into your user profile. Rust itself is managed by `rustup` so the resulting `cargo` and `rustc` behave the same as the non-Nix setup.

```sh
xcode-select --install
nix --extra-experimental-features 'nix-command flakes' profile install nixpkgs#rustup nixpkgs#cmake nixpkgs#ninja
curl -fsSL https://bun.com/install | bash -s "bun-v1.3.10"
```

Open a new terminal after installation. From this point onward, no project command requires `nix develop`, `nix shell`, or another Nix command.

### Install without Nix

```sh
xcode-select --install
brew install cmake ninja
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
curl -fsSL https://bun.com/install | bash -s "bun-v1.3.10"
```

Open a new terminal after installation.

### Project setup

Both installation methods use the same command from here onward:

```sh
rustup toolchain install 1.96.1 --profile minimal --component rustfmt
bun run setup
```

Confirm the toolchain if setup fails:

```sh
bun --version
rustc --version
cargo --version
cmake --version
ninja --version
```

## Development

Run the Tauri desktop app:

```sh
bun run app:dev
```

Create the desktop app build:

```sh
bun run app:build
```

Vite is started internally by Tauri and is not a standalone product or deployment target. The app stores SQLite and generated `.scd` files under the macOS application data directory for `app.lyra.focus`. Closing the main window hides it; the Rust timer and music runtime continue. Quitting marks running focus sessions as interrupted.

## Music generation quality contract

The generation prompt treats a theme as timbre and space, while the arrangement controls musical structure. Ambient is the default; saved tracks and variations retain the selected arrangement.

Every Codex generation turn receives the same structured musical contract plus only the recipe for the selected arrangement and theme. Unselected recipes are omitted so their tempo, instrumentation, and texture guidance cannot conflict. The common contract asks for a major or major-pentatonic tonal center, a mid-register lead, consonant harmony, bounded layer amplitudes, separated spectral roles, gentle envelopes, and predictable phrases. It explicitly rejects sub-bass drones, semitone clusters, tritones, alarm-like repetition, fast rough modulation, abrupt stereo motion, and unconstrained pitch randomness.

Subtle 1/f-like motion is expressed as bounded, multi-timescale control drift rather than as audible pink noise: slow `LFNoise1` layers may vary amplitude, filtering, pan, and phrase timing within narrow limits, but never pitch or harmony. This is an approximation for avoiding mechanical repetition, not a claim of a medical or universal relaxation effect.

Automated tests lock the prompt sections and numeric constraints so they cannot silently regress. They guarantee that Codex receives the quality instructions; they do not measure perceived quality, loudness, or the actual spectrum of a generated track.

## SuperCollider compatibility gate

Run this before BGM generation or playback work:

```sh
bun run sc:check
```

The gate performs `sclang start → scsynth boot → 440 Hz for two seconds → clean shutdown`. On the current macOS 26.5.2 development machine, the universal SuperCollider 3.14.1 `sclang` aborts before language startup with:

```text
Incompatible processor. This Qt build requires the following features:
    neon
```

Build and install the tested arm64 headless language runtime with:

```sh
bun run sc:build
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

## Codex plugin

The Codex plugin manifest, arm64 MCP executable, and `$adding-lyra-tasks` Skill are tracked under `plugins/lyra`. Register this repository as a local marketplace and install it through the native Codex plugin commands:

```sh
codex plugin marketplace add .
codex plugin add lyra@lyra-local
```

No repository installer mutates home-directory configuration or copies plugin files. Codex reads the tracked marketplace and creates its own cache. Start a new Codex task after installation so it loads the Skill and MCP server.

The server uses Lyra's default database at `~/Library/Application Support/app.lyra.focus/lyra.db` and exposes only:

```ts
add_task({
  title: string,
  list: "today" | "backlog",
  estimatedPomodoros?: number
})
```

## MCP task tool development

Build the server:

```sh
bun run mcp:build
```

When the release binary changes, replace the bundled executable before reinstalling the plugin:

```sh
/Users/murabito/.cargo/bin/cargo build --release -p lyra-mcp
cp target/release/lyra-mcp plugins/lyra/bin/lyra-mcp
```

Register the resulting executable in Codex configuration, replacing the paths with the local checkout and Lyra database location:

```toml
[mcp_servers.lyra]
command = "/absolute/path/to/Lyra/target/debug/lyra-mcp"

[mcp_servers.lyra.env]
LYRA_DB_PATH = "/Users/you/Library/Application Support/app.lyra.focus/lyra.db"
```

The desktop UI polls the shared WAL-mode database every 1.5 seconds, keeping MCP additions within the two-second reflection target.

## Verification

```sh
bun run setup
bun run verify
bun run app:build
SCLANG=/path/to/headless/sclang bun run sc:check
bun run runtime:check
bun run generation:check
```

On macOS 26.5.2, run `bun run sc:build` first and then point the gate at the installed headless binary if Lyra has not yet discovered it. The short audio gate passes; long-running real-audio endurance checks—50-minute focus, 100 pause/resume cycles, process-kill recovery, and the 4 themes × 3 tracks human listening score—remain release QA.

## Security boundary

The MVP never accepts free-form SuperCollider prompts, samples, microphone input, Quarks, user Extensions, or additional UGen plugins. The allowlist reduces risk but is not treated as a complete security boundary.
