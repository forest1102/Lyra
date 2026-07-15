import { describe, expect, test } from "vitest";
import { browserPreviewBpm, DEFAULT_MUSIC_GENERATION_REQUEST } from "./musicControls";

describe("BGM生成コントロール", () => {
  test("アンビエントを既定の曲調にする", () => {
    expect(DEFAULT_MUSIC_GENERATION_REQUEST).toMatchObject({
      theme: "deep-space",
      arrangement: "ambient",
      brightness: "medium",
      density: "medium",
      motion: "low"
    });
  });

  test("ブラウザ用BPMを曲調とmotionの範囲から決める", () => {
    expect([
      browserPreviewBpm("ambient", "medium"),
      browserPreviewBpm("lofi", "medium"),
      browserPreviewBpm("minimal-melody", "medium")
    ]).toEqual([63, 78, 74]);
    expect(browserPreviewBpm("ambient", "low")).toBeLessThan(browserPreviewBpm("ambient", "high"));
  });
});
