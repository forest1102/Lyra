import { describe, expect, test } from "vitest";
import { MOOD_CATALOG, createMusicRecipe, normalizeMusicRecipe, removeMoodFromRecipe } from "./moodCatalog";

describe("shared mood catalog", () => {
  test("contains five categories with six unique moods each", () => {
    expect(MOOD_CATALOG.version).toBe(1);
    expect(MOOD_CATALOG.categories).toHaveLength(5);
    expect(MOOD_CATALOG.categories.every((category) => category.moods.length === 6)).toBe(true);
    const ids = MOOD_CATALOG.categories.flatMap((category) => category.moods.map((mood) => mood.id));
    expect(new Set(ids).size).toBe(30);
  });

  test("ships a local WebP for every catalog mood", () => {
    const publicDirectory = fileURLToPath(new URL("../../public/", import.meta.url));
    for (const mood of MOOD_CATALOG.categories.flatMap((category) => category.moods)) {
      expect(mood.image.endsWith(".webp")).toBe(true);
      expect(existsSync(resolve(publicDirectory, mood.image.replace(/^\//, ""))), mood.id).toBe(true);
    }
  });

  test("creates an equally weighted recipe for selected mood IDs", () => {
    expect(createMusicRecipe(["scene-rainy-window", "time-midnight"]).moods).toEqual([
      { moodId: "scene-rainy-window", weight: 0.5 },
      { moodId: "time-midnight", weight: 0.5 },
    ]);
  });

  test("rejects unknown, duplicate, excessive, and invalid weights", () => {
    expect(() => normalizeMusicRecipe({ version: 1, moods: [{ moodId: "missing", weight: 1 }] })).toThrow("unknown mood");
    expect(() => normalizeMusicRecipe({ version: 1, moods: [
      { moodId: "scene-rainy-window", weight: 0.5 },
      { moodId: "scene-rainy-window", weight: 0.5 },
    ] })).toThrow("duplicate");
    expect(() => normalizeMusicRecipe({ version: 1, moods: Array.from({ length: 6 }, (_, index) => ({
      moodId: MOOD_CATALOG.categories[index % 5].moods[index % 6].id,
      weight: 1 / 6,
    })) })).toThrow("1 to 5");
    expect(() => normalizeMusicRecipe({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: Number.NaN }] })).toThrow("weight");
  });

  test("normalizes valid positive weights to an exact total of one", () => {
    const recipe = normalizeMusicRecipe({ version: 1, moods: [
      { moodId: "scene-rainy-window", weight: 4 },
      { moodId: "time-midnight", weight: 1 },
    ] });
    expect(recipe.moods).toEqual([
      { moodId: "scene-rainy-window", weight: 0.8 },
      { moodId: "time-midnight", weight: 0.2 },
    ]);
  });

  test("removes a mood while preserving the remaining weight ratio", () => {
    const recipe = normalizeMusicRecipe({ version: 1, moods: [
      { moodId: "scene-rainy-window", weight: 0.6 },
      { moodId: "time-midnight", weight: 0.3 },
      { moodId: "texture-velvet", weight: 0.1 },
    ] });

    expect(removeMoodFromRecipe(recipe, "time-midnight").moods).toEqual([
      { moodId: "scene-rainy-window", weight: 0.857142857143 },
      { moodId: "texture-velvet", weight: 0.142857142857 },
    ]);
  });

  test("does not remove the last mood", () => {
    const recipe = createMusicRecipe(["scene-rainy-window"]);

    expect(removeMoodFromRecipe(recipe, "scene-rainy-window")).toEqual(recipe);
  });
});
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
