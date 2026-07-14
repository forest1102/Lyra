# BGM生成進捗表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BGM生成をコード生成から音声検証・自動試聴まで連続実行し、現在の処理段階を日本語で表示する。

**Architecture:** クライアントに副作用を注入できる生成パイプライン関数を追加し、既存の非同期Tauriコマンドを順番に呼ぶ。画面はパイプラインから通知される段階だけを保持し、RustとSuperColliderの既存実装は変更しない。

**Tech Stack:** TypeScript、React Native、Expo Router、Vitest、Bun、Turborepo

## Global Constraints

- UI文言は日本語にする。
- `generate_music`と`preview_music_draft`は非同期のまま利用する。
- 集中中は音声検証を開始せず、延期状態を表示する。
- コミットとプッシュは行わない。

---

### Task 1: 生成パイプライン

**Files:**
- Create: `apps/client/src/services/musicGeneration.ts`
- Create: `apps/client/src/services/musicGeneration.test.ts`

**Interfaces:**
- Consumes: `MusicGenerationRequest`、`MusicDraft`
- Produces: `runMusicGeneration(input): Promise<MusicDraft>`、`MusicGenerationPhase`、`MusicGenerationPipelineError`

- [ ] **Step 1: 失敗するテストを書く**

成功、集中中の延期、コード生成失敗、音声処理失敗をテストする。成功テストは通知順が`coding → audio → completed`であり、生成Draftを試聴へ渡すことを検証する。

```ts
const phases: MusicGenerationPhase[] = [];
const result = await runMusicGeneration({
  request,
  generate: async () => draft,
  preview: async (target) => ({ ...target, audioValidation: "passed" }),
  onPhase: (phase) => phases.push(phase)
});
expect(phases).toEqual(["coding", "audio", "completed"]);
expect(result.audioValidation).toBe("passed");
```

- [ ] **Step 2: テストが未実装で失敗することを確認する**

Run: `bunx vitest run apps/client/src/services/musicGeneration.test.ts`
Expected: FAIL because `./musicGeneration` does not exist.

- [ ] **Step 3: 最小実装を書く**

```ts
export type MusicGenerationPhase = "idle" | "coding" | "audio" | "deferred" | "completed" | "failed";
export type MusicGenerationFailureStage = "coding" | "audio";

export class MusicGenerationPipelineError extends Error {
  constructor(readonly stage: MusicGenerationFailureStage, readonly cause: unknown) {
    super(stage === "coding" ? "music coding failed" : "music audio generation failed");
  }
}

export async function runMusicGeneration(input: MusicGenerationPipelineInput): Promise<MusicDraft> {
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
```

- [ ] **Step 4: 狭いテストを通す**

Run: `bunx vitest run apps/client/src/services/musicGeneration.test.ts`
Expected: 4 tests PASS.

### Task 2: ContextとBGM制作画面への統合

**Files:**
- Modify: `apps/client/src/state/LyraContext.tsx`
- Modify: `apps/client/app/(tabs)/studio.tsx`
- Modify: `apps/client/src/ui/labels.ts`
- Modify: `apps/client/src/ui/labels.test.ts`

**Interfaces:**
- Consumes: `runMusicGeneration`、`MusicGenerationPhase`
- Produces: `generateTrack(request): Promise<MusicDraft>`、`previewDraft(target): Promise<MusicDraft>`、段階別日本語表示

- [ ] **Step 1: 表示文言の失敗するテストを書く**

```ts
expect(generationProgressLabel("coding")).toBe("1/2 SuperColliderをコーディング中…");
expect(generationProgressLabel("audio")).toBe("2/2 音声を生成・検証中…");
expect(generationProgressLabel("deferred")).toContain("集中終了後");
expect(generationProgressLabel("completed")).toContain("完了");
```

- [ ] **Step 2: 文言テストが未実装で失敗することを確認する**

Run: `bunx vitest run apps/client/src/ui/labels.test.ts`
Expected: FAIL because `generationProgressLabel` is not exported.

- [ ] **Step 3: Contextの戻り値と試聴対象を明示する**

`generateTrack`は生成Draftをstateへ保存して返す。`previewDraft(target)`は渡されたDraftを直接利用して、React state更新直後でも自動試聴できるようにする。

```ts
async generateTrack(request) {
  const track = desktopBridge.available() ? await desktopBridge.generateTrack(request) : generatedFixture(request);
  setDraft(track);
  return track;
},
async previewDraft(target) {
  const validated = desktopBridge.available()
    ? await desktopBridge.previewDraft(target.id)
    : { ...target, audioValidation: "passed" as const };
  setDraft(validated);
  return validated;
}
```

- [ ] **Step 4: 画面でパイプラインを実行する**

`StudioScreen`は`MusicGenerationPhase`を保持し、生成ボタンから`runMusicGeneration`を呼ぶ。処理中は段階別文言をボタンとライブリージョンへ表示し、成功時は自動試聴済みDraftを表示する。`MusicGenerationPipelineError.stage`でコード生成エラーと音声処理エラーを分ける。

- [ ] **Step 5: クライアントテストと型検査を通す**

Run: `bunx turbo run test typecheck --filter=@lyra/client`
Expected: client test and typecheck PASS.

- [ ] **Step 6: 全体検証を通す**

Run: `nix shell nixpkgs#cargo nixpkgs#rustfmt -c bunx turbo run test typecheck check fmt:check`
Expected: all Turbo tasks PASS with no formatting errors.
