// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMusicRecipe, normalizeMusicRecipe } from "../../services/moodCatalog";
import { createOrbModel, createOrbTransition, MoodOrb } from "./MoodOrb";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createCanvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

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

  test("allocates more particles and a tighter orbit to heavier moods", () => {
    const recipe = normalizeMusicRecipe({ version: 1, moods: [
      { moodId: "scene-rainy-window", weight: 0.8 },
      { moodId: "time-midnight", weight: 0.2 },
    ] });

    const model = createOrbModel(recipe, "composing");

    expect(model.cycleMs).toBe(2_400);
    expect(model.stops[0].particleCount).toBeGreaterThan(model.stops[1].particleCount);
    expect(model.stops[0].orbitRadius).toBeLessThan(model.stops[1].orbitRadius);
  });

  test("models convergence, reconstruction, and the 600ms settle", () => {
    const recipe = createMusicRecipe(["scene-rainy-window", "time-midnight"]);
    const composing = createOrbModel(recipe, "composing");
    const validating = createOrbModel(recipe, "source_validating");
    const repairing = createOrbModel(recipe, "repairing");
    const ready = createOrbModel(recipe, "ready");

    expect(validating.convergence).toBeGreaterThan(composing.convergence);
    expect(repairing.speed).toBeGreaterThan(validating.speed);
    expect(repairing.reconstructive).toBe(true);
    expect(ready.settleDurationMs).toBe(600);
  });

  test("settles only when ready follows active generation", () => {
    expect(createOrbTransition("ready", "repairing")).toEqual({ settling: true, displayPhase: "repairing" });
    expect(createOrbTransition("completed", "repairing")).toEqual({ settling: false, displayPhase: "completed" });
    expect(createOrbTransition("completed", "audio")).toEqual({ settling: false, displayPhase: "completed" });
  });

  test("renders a static recipe without scheduling RAF for reduced motion", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");
    const context = createCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);

    render(createElement(MoodOrb, { recipe: createMusicRecipe(["scene-rainy-window"]), phase: "composing" }));

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(context.fillText).toHaveBeenCalledWith("雨の窓辺", expect.any(Number), expect.any(Number));
  });
});
