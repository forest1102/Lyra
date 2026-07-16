import { describe, expect, test } from "vitest";
import { detectRuntime, type RuntimeEnvironment } from "./runtime";

function environment(overrides: Partial<RuntimeEnvironment> = {}): RuntimeEnvironment {
  return {
    development: false,
    e2e: false,
    tauriInternals: false,
    ...overrides,
  };
}

describe("実行環境の判定", () => {
  test("E2EフラグをTauri内部APIより優先する", () => {
    expect(detectRuntime(environment({ e2e: true, tauriInternals: true }))).toBe("tauri-e2e");
  });

  test("E2EフラグだけではTauri E2Eとしてdesktop bridgeへ流さない", () => {
    expect(detectRuntime(environment({ e2e: true }))).toBe("unsupported-browser");
    expect(detectRuntime(environment({ development: true, e2e: true }))).toBe("browser-development");
  });

  test("Tauri内部APIがある通常bundleをdesktop productionとして扱う", () => {
    expect(detectRuntime(environment({ tauriInternals: true }))).toBe("tauri-production");
  });

  test("開発bundleをTauri外で開いた場合だけbrowser developmentとして扱う", () => {
    expect(detectRuntime(environment({ development: true }))).toBe("browser-development");
  });

  test("production bundleをTauri外で開いた場合はunsupported browserとして扱う", () => {
    expect(detectRuntime(environment())).toBe("unsupported-browser");
  });
});
