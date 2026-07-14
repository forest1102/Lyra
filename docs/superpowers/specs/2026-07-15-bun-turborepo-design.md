# Bun / Turborepo command architecture

## Decision

Lyra will use Bun as its only JavaScript package manager and command runtime. Turborepo will own the repository task graph, dependency ordering, parallel execution, output declarations, and caching. `package-lock.json` and every `npm run` invocation will be removed.

The migration is complete rather than hybrid: no npm compatibility scripts or secondary lockfile remain. Bun 1.3.10 is pinned in the root `packageManager` field and `bun.lock` is committed.

## Turborepo boundary

The root `turbo.json` is the source of truth for task orchestration. It defines `dev`, `build`, `export`, `test`, `typecheck`, `check`, `fmt:check`, `build:desktop`, and `build:supercollider`, including dependencies, persistence, cache behavior, inputs, and outputs.

Turborepo discovers the executable for a task from the matching `scripts` entry in each workspace package. Therefore package-local `scripts` remain only as leaf command adapters such as `expo export`, `tsc`, `vitest`, `tauri build`, and `cargo test`; they do not perform cross-workspace orchestration. This is the execution model required by Turborepo's task configuration.

Developers invoke tasks through the repository-local Turbo binary using Bun:

```sh
bunx turbo run dev --filter=@lyra/client
bunx turbo run dev --filter=@lyra/desktop
bunx turbo run build
bunx turbo run test typecheck check
bunx turbo run build:supercollider --filter=@lyra/native-tooling
```

## Workspace changes

- Root `package.json`: keeps workspace discovery and shared development dependencies, pins Bun, and stops chaining workspace commands.
- `apps/client`: exposes leaf `dev`, `build`, and `typecheck` commands.
- `apps/desktop`: exposes leaf `dev` and `build:desktop` commands.
- `packages/domain`: exposes leaf `build`, `test`, and `typecheck` commands.
- `tooling/native`: new private workspace that adapts Cargo and the SuperCollider compatibility/build scripts into Turbo tasks.
- Tauri `beforeDevCommand` and `beforeBuildCommand`: call the repository-local Turbo binary through Bun, never npm.

The client declares `@lyra/domain` with `workspace:*` so Bun and Turborepo both see the package dependency edge. Build ordering can then use `^build` safely.

## Task and cache policy

- `dev`: persistent and never cached.
- TypeScript `build`: depends on dependency-package builds and caches `dist/**` or `lib/**`.
- Expo `build`: depends on dependency-package builds and caches the static `dist/**` export.
- `test` and `typecheck`: cache logs/results but declare no generated artifact unless the tool creates one.
- Cargo `check`, `test`, and `fmt:check`: run through `@lyra/native-tooling`; Cargo's own incremental cache remains authoritative, so Turbo does not cache the shared root `target` directory.
- Tauri desktop and SuperCollider runtime builds: never use remote/task output caching because they create platform-specific artifacts and may access audio, Nix, or external source downloads.
- Environment-dependent SuperCollider paths are pass-through variables, not cache keys for unrelated TypeScript tasks.

## Failure behavior

- `bun install --frozen-lockfile` fails if manifests and `bun.lock` diverge.
- Turbo stops dependent tasks when prerequisites fail while independent tasks continue in parallel.
- Tauri build failure preserves the successful Expo/domain cache entries.
- Native tool absence (`cargo`, `nix`, SuperCollider) fails only the requested native task and does not block client-only development.

## Verification

The migration is accepted when:

1. `package-lock.json` is absent and `bun.lock` is present.
2. `rg 'npm run|npm install'` finds no project-owned command or documentation reference.
3. `bun install --frozen-lockfile` succeeds.
4. Turbo dry-run shows the expected package graph and task dependencies.
5. Turbo runs TypeScript tests, typechecks, Expo export, Rust tests/check/format, and the Tauri `.app` build.
6. The arm64 headless SuperCollider compatibility gate still reaches clean shutdown.

## Alternatives rejected

- Keeping npm's lockfile alongside Bun was rejected because dual lockfiles can resolve different graphs and make Turbo hashing unstable.
- Using Bun workspaces without Turborepo was rejected because it lacks the requested repository-level task graph and cache declarations.
- Putting shell commands directly in `turbo.json` was rejected because Turborepo's supported model registers task metadata there and resolves command bodies from same-named package scripts.
