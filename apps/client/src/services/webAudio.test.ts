import { describe, expect, it } from "vitest";
import type { MusicArrangement, MusicGenerationRequest } from "@lyra/domain";
import { browserPreviewPlan } from "./webAudio";

type PreviewInput = MusicGenerationRequest & { bpm: number };

describe("browser preview arrangement", () => {
  it("uses distinct midrange voicings and motion for every arrangement", () => {
    const request: Omit<PreviewInput, "arrangement"> = {
      theme: "deep-space",
      brightness: "medium",
      density: "medium",
      motion: "low",
      bpm: 72
    };
    const arrangements: MusicArrangement[] = ["ambient", "lofi", "minimal-melody"];
    const plans = arrangements.map((arrangement) => browserPreviewPlan({ ...request, arrangement }));

    expect(new Set(plans.map((plan) => plan.frequencies.join(","))).size).toBe(3);
    expect(plans[0].lfoFrequency).toBeLessThan(plans[1].lfoFrequency);
    expect(plans[1].lfoFrequency).toBeLessThan(plans[2].lfoFrequency);
    for (const plan of plans) {
      expect(Math.min(...plan.frequencies)).toBeGreaterThanOrEqual(196);
      expect(Math.max(...plan.frequencies)).toBeLessThanOrEqual(880);
    }
  });
});
