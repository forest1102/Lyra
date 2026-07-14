import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

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
      "build:supercollider",
      "check:supercollider",
    ]) {
      expect(tasks[task]).toBeDefined();
    }
    expect(tasks.dev).toMatchObject({ cache: false, persistent: true });
    expect(tasks["build:desktop"].cache).toBe(false);
    expect(tasks["build:supercollider"].cache).toBe(false);
  });

  test("contains no npm command path", () => {
    const scan = Bun.spawnSync(
      [
        "rg",
        "-n",
        "npm " + "(run|install)|npm " + "--prefix",
        "README.md",
        "package.json",
        "apps",
        "packages",
        "tooling",
        "scripts",
        "docs/architecture.md",
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    expect(new TextDecoder().decode(scan.stdout)).toBe("");
    expect(scan.exitCode).toBe(1);
  });
});
