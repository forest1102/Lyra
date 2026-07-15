import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { scanForForbiddenNpmCommands } from "./repositoryScan";

const root = resolve(import.meta.dir, "..");
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

describe("repository tooling", () => {
  test("uses only Bun's lockfile and package manager", () => {
    expect(json("package.json").packageManager).toBe("bun@1.3.10");
    expect(existsSync(resolve(root, "bun.lock"))).toBe(true);
    expect(existsSync(resolve(root, "package-lock.json"))).toBe(false);
  });

  test("registers the required Turbo tasks", () => {
    const turbo = json("turbo.json");
    const tasks = turbo.tasks;
    expect(turbo.cacheDir).toBe(".turbo/cache");
    for (const task of [
      "dev",
      "build",
      "test",
      "typecheck",
      "check",
      "fmt:check",
      "build:mcp",
      "build:desktop",
    ]) {
      expect(tasks[task]).toBeDefined();
    }
    expect(tasks.dev).toMatchObject({ cache: false, persistent: true });
    expect(tasks["build:desktop"].cache).toBe(false);
  });

  test("contains no npm command path", () => {
    expect(
      scanForForbiddenNpmCommands(root, [
        "README.md",
        "package.json",
        "apps",
        "tooling",
        "scripts",
        "docs/architecture.md",
      ]),
    ).toEqual([]);
  });

  test("uses only the system default output without requesting microphone access", () => {
    const tauri = json("apps/desktop/src-tauri/tauri.conf.json");
    expect(tauri.bundle.macOS.entitlements).toBeUndefined();
    expect(tauri.bundle.macOS.infoPlist).toBeUndefined();
    expect(existsSync(resolve(root, "apps/desktop/src-tauri/Entitlements.plist"))).toBe(false);
    expect(existsSync(resolve(root, "apps/desktop/src-tauri/Info.plist"))).toBe(false);
    expect(readFileSync(resolve(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8"))
      .not.toContain("objc2-av-foundation");
  });

  test("installs the tagged WebChucK runtime instead of storing it in public", () => {
    const desktop = json("apps/desktop/package.json");
    const viteConfig = readFileSync(resolve(root, "apps/desktop/vite.config.ts"), "utf8");

    expect(desktop.dependencies.webchuck).toBe("github:ccrma/webchuck#v1.2.11");
    expect(desktop.devDependencies["vite-plugin-static-copy"]).toBe("4.1.1");
    expect(existsSync(resolve(root, "apps/desktop/public/webchuck"))).toBe(false);
    expect(viteConfig).toContain("webChuckRuntime");

    const assets = {
      "webchuck.js": "2867257bde39f389f67eeaebb5f32adc5c85a3dfa66600139e2140de978ca0c6",
      "webchuck.wasm": "f3b103126914824c08766af76d1c9f182b28e61d0300523eb89bd6599cc49946",
    };
    for (const [filename, expectedHash] of Object.entries(assets)) {
      const path = resolve(root, "node_modules/webchuck/src", filename);
      expect(existsSync(path)).toBe(true);
      if (!existsSync(path)) continue;
      const bytes = readFileSync(path);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expectedHash);
    }
  });
});
