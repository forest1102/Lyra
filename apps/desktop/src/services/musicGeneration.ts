import type { MusicDraft, MusicGenerationProgress, MusicGenerationRequest } from "../domain";

type MusicGenerationWorkPhase = "composing" | "source_validating" | "repairing";
export type MusicGenerationPhase = "idle" | MusicGenerationWorkPhase | "ready" | "audio" | "deferred" | "completed" | "failed";
export type MusicGenerationFailureStage = MusicGenerationWorkPhase;

export function isActiveGenerationPhase(phase: MusicGenerationPhase): phase is MusicGenerationWorkPhase {
  return phase === "composing" || phase === "source_validating" || phase === "repairing";
}

interface MusicGenerationPipelineInput {
  request: MusicGenerationRequest;
  generate(request: MusicGenerationRequest, onProgress: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  onPhase(phase: MusicGenerationPhase): void;
}

export class MusicGenerationPipelineError extends Error {
  readonly cause: unknown;

  constructor(readonly stage: MusicGenerationFailureStage, cause: unknown) {
    super("music generation failed");
    this.name = "MusicGenerationPipelineError";
    this.cause = cause;
  }
}

export async function runMusicGeneration(input: MusicGenerationPipelineInput): Promise<MusicDraft> {
  let lastPhase: MusicGenerationPhase = "idle";
  let failureStage: MusicGenerationFailureStage = "composing";
  const onProgress = (progress: MusicGenerationProgress) => {
    if (progress.phase === "started") return;
    const phase: MusicGenerationPhase = progress.phase === "validating" || progress.phase === "previewing"
      ? "audio"
      : progress.phase;
    if (isActiveGenerationPhase(phase)) {
      failureStage = phase;
    }
    if (phase !== lastPhase) {
      lastPhase = phase;
      input.onPhase(phase);
    }
  };
  let draft: MusicDraft;
  try {
    draft = await input.generate(input.request, onProgress);
  } catch (error) {
    throw new MusicGenerationPipelineError(failureStage, error);
  }
  if (draft.audioValidation === "deferred_until_focus_ends") {
    input.onPhase("deferred");
    return draft;
  }
  input.onPhase("ready");
  return draft;
}
