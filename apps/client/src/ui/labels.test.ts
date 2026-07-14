import { describe, expect, test } from "vitest";
import {
  generationProgressLabel,
  intensityLabel,
  phaseLabel,
  presetLabel,
  themeLabel
} from "./labels";

describe("日本語表示", () => {
  test("BGMテーマと強度を日本語にする", () => {
    expect(themeLabel("deep-space")).toBe("深宇宙");
    expect(intensityLabel("medium")).toBe("中");
  });

  test("タイマーのフェーズと組み込みプリセットを日本語にする", () => {
    expect(phaseLabel("short_break")).toBe("短い休憩");
    expect(presetLabel({
      id: "standard",
      name: "Standard",
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      cyclesBeforeLongBreak: 4,
      builtIn: true
    })).toBe("スタンダード");
  });

  test("BGM生成の処理段階を日本語にする", () => {
    expect(generationProgressLabel("coding")).toBe("1/2 SuperColliderをコーディング中…");
    expect(generationProgressLabel("audio")).toBe("2/2 音声を生成・検証中…");
    expect(generationProgressLabel("deferred")).toContain("集中終了後");
    expect(generationProgressLabel("completed")).toContain("完了");
  });
});
