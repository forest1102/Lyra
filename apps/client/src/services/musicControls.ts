import type { MusicArrangement, MusicGenerationRequest, MusicIntensity } from "@lyra/domain";

export const DEFAULT_MUSIC_GENERATION_REQUEST: MusicGenerationRequest = {
  theme: "deep-space",
  arrangement: "ambient",
  brightness: "medium",
  density: "medium",
  motion: "low"
};

export function browserPreviewBpm(
  arrangement: MusicArrangement,
  motion: MusicIntensity
): number {
  const range: Record<MusicArrangement, Record<MusicIntensity, number>> = {
    ambient: { low: 54, medium: 63, high: 72 },
    lofi: { low: 68, medium: 78, high: 88 },
    "minimal-melody": { low: 64, medium: 74, high: 84 }
  };
  return range[arrangement][motion];
}
