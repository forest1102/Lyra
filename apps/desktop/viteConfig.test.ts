import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { build } from "vite";
import {
  assertWebChuckRuntimeAssets,
  WEBCHUCK_ASSET_ROOT,
  WEBCHUCK_SOURCE_DIRECTORY,
} from "./vite.config";

const temporaryDirectories: string[] = [];
const desktopRoot = fileURLToPath(new URL(".", import.meta.url));

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("WebChucK Vite integration", () => {
  test("accepts the assets installed from the tagged repository", () => {
    expect(WEBCHUCK_ASSET_ROOT).toBe("/webchuck/");
    expect(() => assertWebChuckRuntimeAssets()).not.toThrow();
  });

  test("rejects a modified runtime asset", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "lyra-webchuck-"));
    temporaryDirectories.push(directory);
    copyFileSync(resolve(WEBCHUCK_SOURCE_DIRECTORY, "webchuck.wasm"), resolve(directory, "webchuck.wasm"));
    writeFileSync(resolve(directory, "webchuck.js"), "modified");

    expect(() => assertWebChuckRuntimeAssets(directory)).toThrow(/SHA-256/);
  });

  test("production bundleからBrowserDevBridgeを除外する", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "lyra-production-build-"));
    temporaryDirectories.push(directory);
    const outDir = resolve(directory, "dist");

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({
        root: desktopRoot,
        mode: "production",
        configFile: resolve(desktopRoot, "vite.config.ts"),
        logLevel: "silent",
        build: { outDir, emptyOutDir: true, manifest: true },
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }

    const outputFiles = filesUnder(outDir);
    const textArtifacts = outputFiles
      .filter((path) => path.endsWith(".js") || path.endsWith("manifest.json"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(outputFiles.filter((path) => /browserDev/i.test(path))).toEqual([]);
    expect(textArtifacts).not.toContain("browser-dev://");
    expect(textArtifacts).not.toContain("静かなブラウザ・ドリフト");
    expect(textArtifacts).toContain("デスクトップアプリから起動してください");
  });
});
