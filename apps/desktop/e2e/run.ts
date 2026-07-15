import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactsDirectory = fileURLToPath(new URL("./artifacts/", import.meta.url));
const dataDirectory = mkdtempSync(`${tmpdir()}/lyra-e2e-`);
const environment = { ...process.env, LYRA_E2E_DATA_DIR: dataDirectory };
let exitCode = 0;

mkdirSync(artifactsDirectory, { recursive: true });

try {
  const build = spawnSync("bun", ["run", "build:e2e"], {
    cwd: desktopDirectory,
    env: environment,
    stdio: "inherit"
  });

  if (build.status !== 0) {
    exitCode = build.status ?? 1;
  } else {
    const tests = spawnSync("bun", ["x", "wdio", "run", "wdio.conf.ts", ...process.argv.slice(2)], {
      cwd: desktopDirectory,
      env: environment,
      stdio: "inherit"
    });
    exitCode = tests.status ?? 1;
  }
} finally {
  rmSync(dataDirectory, { recursive: true, force: true });
}

process.exitCode = exitCode;
