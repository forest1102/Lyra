export type AppRuntime =
  | "tauri-production"
  | "tauri-e2e"
  | "browser-development"
  | "unsupported-browser";

export interface RuntimeEnvironment {
  development: boolean;
  e2e: boolean;
  tauriInternals: boolean;
}

export function detectRuntime(environment: RuntimeEnvironment): AppRuntime {
  if (environment.e2e && environment.tauriInternals) return "tauri-e2e";
  if (environment.tauriInternals) return "tauri-production";
  if (environment.development) return "browser-development";
  return "unsupported-browser";
}

export function detectCurrentRuntime(): AppRuntime {
  const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
  return detectRuntime({
    development: import.meta.env.DEV,
    e2e: import.meta.env.VITE_E2E === "1",
    tauriInternals: runtimeWindow.__TAURI_INTERNALS__ !== undefined,
  });
}
