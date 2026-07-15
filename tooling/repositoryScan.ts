import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const forbiddenNpmCommand = new RegExp(["npm ", "(?:run|install)|npm ", "--prefix"].join(""), "g");

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    filesUnder(resolve(path, entry.name)),
  );
}

export function scanForForbiddenNpmCommands(root: string, paths: string[]): string[] {
  return paths.flatMap((path) => {
    const absolutePath = resolve(root, path);
    return filesUnder(absolutePath).flatMap((file) => {
      const content = readFileSync(file, "utf8");
      return content.match(forbiddenNpmCommand)?.map((match) => `${file}: ${match}`) ?? [];
    });
  });
}
