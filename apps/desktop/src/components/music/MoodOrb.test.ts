import { describe, expect, test } from "vitest";
import { createMusicRecipe } from "../../services/moodCatalog";
import { createOrbModel } from "./MoodOrb";

describe("createOrbModel", () => {
  test("maps normalized mood weights to colors and weighted vectors", () => {
    const model = createOrbModel(createMusicRecipe(["scene-rainy-window", "time-midnight"]));

    expect(model.stops).toHaveLength(2);
    expect(model.stops.map((stop) => stop.weight)).toEqual([0.5, 0.5]);
    expect(model.vectors.space).toBeCloseTo(0.91);
    expect(model.motion).toBeCloseTo(0.23);
  });

  test("uses a calm fallback when no recipe is selected", () => {
    const model = createOrbModel(null);
    expect(model.stops).toHaveLength(2);
    expect(model.motion).toBe(0);
  });
});
