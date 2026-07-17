import { describe, expect, test } from "vitest";
import type { LegacyMusicGenerationRequest, MusicDraft } from "../domain";
import { runMusicGeneration, type MusicGenerationPhase } from "./musicGeneration";

const request: LegacyMusicGenerationRequest = { theme: "deep-space", arrangement: "ambient", brightness: "medium", density: "medium", motion: "low" };

function draft(audioValidation: MusicDraft["audioValidation"] = "pending"): MusicDraft {
  return {
    id: "draft-1", parentTrackId: null, title: "深宇宙 42", description: "フォーカス用BGM", ...request,
    bpm: 64, tailSeconds: 4, chuckSource: "Math.srandom(__LYRA_SEED__); SinOsc osc => dac; while(true) { 1::second => now; }",
    sourceSha256: "sha256", canonicalSeed: 42, audioValidation,
    recipeVersion: null, recipeJson: null, structureFamily: "ambient"
  };
}

describe("BGM生成パイプライン", () => {
  test("コード生成後は明示的な再生操作を待つ", async () => {
    const phases: MusicGenerationPhase[] = [];
    const result = await runMusicGeneration({
      request,
      generate: async (_request, onProgress) => {
        onProgress({ phase: "started" });
        onProgress({ phase: "composing" });
        onProgress({ phase: "source_validating" });
        return draft();
      },
      onPhase: (phase) => phases.push(phase)
    });
    expect(phases).toEqual(["composing", "source_validating", "ready"]);
    expect(result.audioValidation).toBe("pending");
  });

  test("集中中は音声処理を呼ばず延期する", async () => {
    const phases: MusicGenerationPhase[] = [];
    const result = await runMusicGeneration({ request, generate: async (_request, onProgress) => { onProgress({ phase: "composing" }); return draft("deferred_until_focus_ends"); }, onPhase: (phase) => phases.push(phase) });
    expect(phases).toEqual(["composing", "deferred"]);
    expect(result.audioValidation).toBe("deferred_until_focus_ends");
  });

  test("コード生成の失敗段階を保持する", async () => {
    await expect(runMusicGeneration({ request, generate: async (_request, onProgress) => { onProgress({ phase: "composing" }); throw new Error("Codex stopped"); }, onPhase: () => undefined })).rejects.toMatchObject({ stage: "composing" });
  });

  test("修復時は静的検証との往復をそのまま通知する", async () => {
    const phases: MusicGenerationPhase[] = [];
    await runMusicGeneration({
      request,
      generate: async (_request, onProgress) => {
        onProgress({ phase: "composing" });
        onProgress({ phase: "source_validating" });
        onProgress({ phase: "repairing" });
        onProgress({ phase: "source_validating" });
        return draft();
      },
      onPhase: (phase) => phases.push(phase),
    });
    expect(phases).toEqual(["composing", "source_validating", "repairing", "source_validating", "ready"]);
  });
});
