import type { MusicDraft, MusicGenerationRequest } from "@lyra/domain";
import { describe, expect, test } from "vitest";
import {
  runMusicGeneration,
  type MusicGenerationPhase
} from "./musicGeneration";

const request: MusicGenerationRequest = {
  theme: "deep-space",
  arrangement: "ambient",
  brightness: "medium",
  density: "medium",
  motion: "low"
};

function draft(audioValidation: MusicDraft["audioValidation"] = "required"): MusicDraft {
  return {
    id: "draft-1",
    parentTrackId: null,
    title: "深宇宙 42",
    description: "フォーカス用BGM",
    ...request,
    bpm: 64,
    tailSeconds: 4,
    supercolliderSource: "(~lyraTrack = (synthDefs: [], pattern: Pseq([1], inf));)",
    sourceSha256: "sha256",
    canonicalSeed: 42,
    audioValidation
  };
}

describe("BGM生成パイプライン", () => {
  test("コード生成後に音声を検証して完了する", async () => {
    const phases: MusicGenerationPhase[] = [];
    const previewed: MusicDraft[] = [];

    const result = await runMusicGeneration({
      request,
      generate: async () => draft(),
      preview: async (target) => {
        previewed.push(target);
        return { ...target, audioValidation: "passed" };
      },
      onPhase: (phase) => phases.push(phase)
    });

    expect(phases).toEqual(["coding", "audio", "completed"]);
    expect(previewed.map(({ id }) => id)).toEqual(["draft-1"]);
    expect(result.audioValidation).toBe("passed");
  });

  test("集中中は音声処理を呼ばず延期する", async () => {
    const phases: MusicGenerationPhase[] = [];
    let previewCalled = false;

    const result = await runMusicGeneration({
      request,
      generate: async () => draft("deferred_until_focus_ends"),
      preview: async (target) => {
        previewCalled = true;
        return target;
      },
      onPhase: (phase) => phases.push(phase)
    });

    expect(phases).toEqual(["coding", "deferred"]);
    expect(previewCalled).toBe(false);
    expect(result.audioValidation).toBe("deferred_until_focus_ends");
  });

  test("コード生成の失敗段階を保持する", async () => {
    const failure = runMusicGeneration({
      request,
      generate: async () => { throw new Error("Codex stopped"); },
      preview: async (target) => target,
      onPhase: () => {}
    });

    await expect(failure).rejects.toMatchObject({ stage: "coding" });
  });

  test("音声処理の失敗段階を保持する", async () => {
    const failure = runMusicGeneration({
      request,
      generate: async () => draft(),
      preview: async () => { throw new Error("scsynth stopped"); },
      onPhase: () => {}
    });

    await expect(failure).rejects.toMatchObject({ stage: "audio" });
  });
});
