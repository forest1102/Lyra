import { describe, expect, test } from "vitest";
import { generationErrorMessage, generationProgressLabel, intensityLabel, phaseLabel, presetLabel, previewErrorMessage, themeLabel } from "./labels";

describe("日本語UIラベル", () => {
  test("ドメイン値を日本語で表示する", () => {
    expect(themeLabel("deep-space")).toBe("深宇宙");
    expect(intensityLabel("medium")).toBe("中");
    expect(phaseLabel("short_break")).toBe("短い休憩");
    expect(presetLabel({ id: "custom", name: "朝の集中", focusMinutes: 40, shortBreakMinutes: 8, longBreakMinutes: 18, cyclesBeforeLongBreak: 3, builtIn: false })).toBe("朝の集中");
  });

  test("失敗箇所ごとの案内を表示する", () => {
    expect(generationErrorMessage()).toContain("Codex CLI");
    expect(previewErrorMessage()).toContain("SuperCollider");
  });

  test("生成段階を2段階で表示する", () => {
    expect(generationProgressLabel("coding")).toContain("1/2");
    expect(generationProgressLabel("audio")).toContain("2/2");
    expect(generationProgressLabel("deferred")).toContain("集中終了後");
  });
});
