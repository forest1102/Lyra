import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "@wdio/tauri-service";
import type { TauriCapabilities } from "@wdio/tauri-service";

const appBinary = fileURLToPath(new URL("../../target/debug/lyra-desktop", import.meta.url));
const artifactsDirectory = fileURLToPath(new URL("./e2e/artifacts/", import.meta.url));
const e2eDataDirectory = process.env.LYRA_E2E_DATA_DIR;

if (!e2eDataDirectory) {
  throw new Error("LYRA_E2E_DATA_DIR must be set by e2e/run.ts");
}

function screenshotName(title: string): string {
  const safeTitle = title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return `${Date.now()}-${safeTitle || "failed-test"}.png`;
}

const capabilities: TauriCapabilities = {
  browserName: "tauri",
  "tauri:options": {
    application: appBinary
  }
};

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./e2e/specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [capabilities],
  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "embedded",
        embeddedPort: 4445,
        env: { LYRA_E2E_DATA_DIR: e2eDataDirectory },
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: "warn",
        frontendLogLevel: "warn",
        logDir: artifactsDirectory,
        restoreMocks: true,
        startTimeout: 60_000
      }
    ]
  ],
  framework: "mocha",
  reporters: ["spec"],
  outputDir: artifactsDirectory,
  logLevel: "warn",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000
  },
  onPrepare() {
    mkdirSync(artifactsDirectory, { recursive: true });
  },
  async afterTest(test, _context, result) {
    if (!result.passed) {
      await browser.saveScreenshot(`${artifactsDirectory}/${screenshotName(test.title)}`);
    }
  }
};
