import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertWebChuckRuntimeAssets,
  WEBCHUCK_ASSET_ROOT,
  WEBCHUCK_SOURCE_DIRECTORY,
} from "./viteWebChuck";

const temporaryDirectories: string[] = [];

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

  test("flattens package assets into the runtime URL root", () => {
    const integrationSource = readFileSync(new URL("./viteWebChuck.ts", import.meta.url), "utf8");
    expect(integrationSource).toContain("rename: { stripBase: true }");
  });
});
