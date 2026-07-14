import { describe, expect, test } from "vitest";
import { selectionPlaybackAction } from "./desktop";

describe("BGM切替", () => {
  test("無音を選ぶと再生停止を要求する", () => {
    expect(selectionPlaybackAction(null)).toBe("silence");
  });

  test("保存曲を選ぶとクロスフェード切替を要求する", () => {
    expect(selectionPlaybackAction("track-1")).toBe("switch");
  });
});
