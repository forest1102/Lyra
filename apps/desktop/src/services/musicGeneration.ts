import type { MusicDraft, MusicGenerationProgress, MusicGenerationRequest } from "../domain";

export type MusicGenerationPhase = "idle" | "coding" | "ready" | "audio" | "deferred" | "completed" | "failed";
export type MusicGenerationFailureStage = "coding";

interface MusicGenerationPipelineInput {
  request: MusicGenerationRequest;
  generate(request: MusicGenerationRequest, onProgress: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  onPhase(phase: MusicGenerationPhase): void;
}

export class MusicGenerationPipelineError extends Error {
  readonly cause: unknown;

  constructor(readonly stage: MusicGenerationFailureStage, cause: unknown) {
    super("music coding failed");
    this.name = "MusicGenerationPipelineError";
    this.cause = cause;
  }
}

export async function runMusicGeneration(input: MusicGenerationPipelineInput): Promise<MusicDraft> {
  let lastPhase: MusicGenerationPhase = "idle";
  const onProgress = (progress: MusicGenerationProgress) => {
    const phase = progress.phase === "started" || progress.phase === "coding" ? "coding" : "audio";
    if (phase !== lastPhase) {
      lastPhase = phase;
      input.onPhase(phase);
    }
  };
  let draft: MusicDraft;
  try {
    draft = await input.generate(input.request, onProgress);
  } catch (error) {
    throw new MusicGenerationPipelineError("coding", error);
  }
  if (draft.audioValidation === "deferred_until_focus_ends") {
    input.onPhase("deferred");
    return draft;
  }
  input.onPhase("ready");
  return draft;
}
