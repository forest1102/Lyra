import type { MusicDraft, MusicGenerationRequest } from "@lyra/domain";

export type MusicGenerationPhase =
  | "idle"
  | "coding"
  | "audio"
  | "deferred"
  | "completed"
  | "failed";

export type MusicGenerationFailureStage = "coding" | "audio";

interface MusicGenerationPipelineInput {
  request: MusicGenerationRequest;
  generate(request: MusicGenerationRequest): Promise<MusicDraft>;
  preview(draft: MusicDraft): Promise<MusicDraft>;
  onPhase(phase: MusicGenerationPhase): void;
}

export class MusicGenerationPipelineError extends Error {
  readonly cause: unknown;

  constructor(readonly stage: MusicGenerationFailureStage, cause: unknown) {
    super(stage === "coding" ? "music coding failed" : "music audio generation failed");
    this.name = "MusicGenerationPipelineError";
    this.cause = cause;
  }
}

export async function runMusicGeneration(
  input: MusicGenerationPipelineInput
): Promise<MusicDraft> {
  input.onPhase("coding");
  let draft: MusicDraft;
  try {
    draft = await input.generate(input.request);
  } catch (error) {
    throw new MusicGenerationPipelineError("coding", error);
  }

  if (draft.audioValidation === "deferred_until_focus_ends") {
    input.onPhase("deferred");
    return draft;
  }

  input.onPhase("audio");
  try {
    const validated = await input.preview(draft);
    input.onPhase("completed");
    return validated;
  } catch (error) {
    throw new MusicGenerationPipelineError("audio", error);
  }
}
