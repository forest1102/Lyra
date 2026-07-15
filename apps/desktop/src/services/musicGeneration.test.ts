import { describe, expect, test } from "vitest";
import type { MusicDraft, MusicGenerationRequest } from "../domain";
import { runMusicGeneration, type MusicGenerationPhase } from "./musicGeneration";

const request: MusicGenerationRequest = { theme: "deep-space", arrangement: "ambient", brightness: "medium", density: "medium", motion: "low" };

function draft(audioValidation: MusicDraft["audioValidation"] = "pending"): MusicDraft {
  return {
    id: "draft-1", parentTrackId: null, title: "深宇宙 42", description: "フォーカス用BGM", ...request,
    bpm: 64, tailSeconds: 4, chuckSource: "Math.srandom(__LYRA_SEED__); SinOsc osc => dac; while(true) { 1::second => now; }",
    sourceSha256: "sha256", canonicalSeed: 42, audioValidation
  };
}

describe("BGM生成パイプライン", () => {
  test("コード生成後は明示的な再生操作を待つ", async () => {
    const phases: MusicGenerationPhase[] = [];
    const result = await runMusicGeneration({
      request,
      generate: async (_request, onProgress) => {
        onProgress({ phase: "coding" });
        return draft();
      },
      onPhase: (phase) => phases.push(phase)
    });
    expect(phases).toEqual(["coding", "ready"]);
    expect(result.audioValidation).toBe("pending");
  });

  test("集中中は音声処理を呼ばず延期する", async () => {
    const phases: MusicGenerationPhase[] = [];
    const result = await runMusicGeneration({ request, generate: async (_request, onProgress) => { onProgress({ phase: "coding" }); return draft("deferred_until_focus_ends"); }, onPhase: (phase) => phases.push(phase) });
    expect(phases).toEqual(["coding", "deferred"]);
    expect(result.audioValidation).toBe("deferred_until_focus_ends");
  });

  test("コード生成の失敗段階を保持する", async () => {
    await expect(runMusicGeneration({ request, generate: async () => { throw new Error("Codex stopped"); }, onPhase: () => undefined })).rejects.toMatchObject({ stage: "coding" });
  });
});
