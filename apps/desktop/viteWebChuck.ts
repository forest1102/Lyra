import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export const WEBCHUCK_ASSET_ROOT = "/webchuck/";
export const WEBCHUCK_SOURCE_DIRECTORY = fileURLToPath(
  new URL("../../node_modules/webchuck/src/", import.meta.url),
);

const EXPECTED_SHA256 = {
  "webchuck.js": "2867257bde39f389f67eeaebb5f32adc5c85a3dfa66600139e2140de978ca0c6",
  "webchuck.wasm": "f3b103126914824c08766af76d1c9f182b28e61d0300523eb89bd6599cc49946",
} as const;

export function assertWebChuckRuntimeAssets(directory = WEBCHUCK_SOURCE_DIRECTORY): void {
  for (const [filename, expected] of Object.entries(EXPECTED_SHA256)) {
    const path = resolve(directory, filename);
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      throw new Error(`WebChucK runtime asset is missing: ${path}`, { cause: error });
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) {
      throw new Error(`WebChucK runtime asset SHA-256 mismatch: ${filename}`);
    }
  }
}

export function webChuckRuntime(): Plugin[] {
  assertWebChuckRuntimeAssets();
  return viteStaticCopy({
    targets: [
      {
        src: Object.keys(EXPECTED_SHA256).map((filename) =>
          normalizePath(resolve(WEBCHUCK_SOURCE_DIRECTORY, filename)),
        ),
        dest: "webchuck",
        rename: { stripBase: true },
      },
    ],
  });
}
