import { useRef, useState } from "react";
import { toast } from "sonner";
import type { MusicDraft } from "../domain";
import { MoodOrb } from "../components/music/MoodOrb";
import { MoodBoard } from "../components/music-alchemy/MoodBoard";
import { MusicRecipePanel } from "../components/music-alchemy/MusicRecipePanel";
import {
  MOOD_CATALOG,
  MOOD_BY_ID,
  createMusicRecipe,
  normalizeMusicRecipe,
  removeMoodFromRecipe,
  type MusicRecipeV1,
} from "../services/moodCatalog";
import { isActiveGenerationPhase, MusicGenerationPipelineError, runMusicGeneration, type MusicGenerationPhase } from "../services/musicGeneration";
import { useLyra } from "../state/LyraContext";
import { generationErrorMessage, previewErrorMessage } from "../ui/labels";
import { Screen } from "../ui/components";
import "./StudioScreen.css";

const DEFAULT_MOODS = ["scene-rainy-window", "temperature-sunlight", "texture-velvet"];

export function rebalanceRecipeWeight(recipe: MusicRecipeV1, moodId: string, requestedWeight: number): MusicRecipeV1 {
  const current = normalizeMusicRecipe(recipe);
  if (current.moods.length === 1) return current;
  const selected = current.moods.find((mood) => mood.moodId === moodId);
  if (!selected) return current;

  const minimumWeight = 0.01;
  const otherCount = current.moods.length - 1;
  const weight = Math.min(1 - minimumWeight * otherCount, Math.max(minimumWeight, requestedWeight));
  const remainingTotal = 1 - selected.weight;
  const distributable = 1 - weight - minimumWeight * otherCount;
  const next = current.moods.map((mood) => {
    if (mood.moodId === moodId) return { ...mood, weight };
    const share = remainingTotal > 0 ? mood.weight / remainingTotal : 1 / (current.moods.length - 1);
    return { ...mood, weight: minimumWeight + share * distributable };
  });
  return normalizeMusicRecipe({ version: 1, moods: next });
}

export function StudioScreen() {
  const {
    draft,
    musicPlayback,
    generateTrack,
    cancelMusicGeneration,
    previewDraft,
    stopMusic,
    saveDraft,
    discardDraft,
  } = useLyra();
  const [activeCategory, setActiveCategory] = useState(MOOD_CATALOG.categories[0].id);
  const [recipe, setRecipe] = useState<MusicRecipeV1>(() => createMusicRecipe(DEFAULT_MOODS));
  const [phase, setPhase] = useState<MusicGenerationPhase>("idle");
  const [cancelling, setCancelling] = useState(false);
  const [repairReceived, setRepairReceived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRun = useRef(0);
  const generating = isActiveGenerationPhase(phase);
  const validating = phase === "audio";
  const editingDisabled = generating || cancelling;
  const draftPlaying = Boolean(draft && musicPlayback.status === "playing" && musicPlayback.trackId === draft.id);

  const toggleMood = (moodId: string) => {
    const ids = recipe.moods.map((mood) => mood.moodId);
    if (ids.includes(moodId)) {
      if (ids.length === 1) {
        toast.info("ムードは1つ以上選んでください");
        return;
      }
      setRecipe(createMusicRecipe(ids.filter((id) => id !== moodId)));
      return;
    }
    if (ids.length >= 5) {
      toast.info("選べるムードは5つまでです");
      return;
    }
    setRecipe(createMusicRecipe([...ids, moodId]));
  };

  const generate = () => {
    const run = ++generationRun.current;
    setError(null);
    setPhase("composing");
    setRepairReceived(false);
    const normalized = normalizeMusicRecipe(recipe);
    void runMusicGeneration({
      request: normalized,
      generate: generateTrack,
      onPhase: (nextPhase) => {
        if (run !== generationRun.current) return;
        if (nextPhase === "repairing") setRepairReceived(true);
        setPhase(nextPhase);
      },
    }).catch((reason: unknown) => {
      if (run !== generationRun.current) return;
      setPhase("failed");
      setError(generationErrorMessage(reason instanceof MusicGenerationPipelineError ? reason.cause : reason));
    });
  };

  const cancelGeneration = () => {
    const cancelledRun = ++generationRun.current;
    setCancelling(true);
    setError(null);
    void cancelMusicGeneration()
      .then(() => {
        if (cancelledRun !== generationRun.current) return;
        setCancelling(false);
        setPhase("idle");
        setRepairReceived(false);
      })
      .catch((reason: unknown) => {
        if (cancelledRun !== generationRun.current) return;
        setCancelling(false);
        setPhase("failed");
        setError(generationErrorMessage(reason));
      });
  };

  const preview = (target: MusicDraft) => {
    setError(null);
    if (draftPlaying) {
      void stopMusic().catch((reason: unknown) => setError(previewErrorMessage(reason)));
      return;
    }
    setPhase("audio");
    void previewDraft(target, () => setPhase("audio"))
      .then(() => setPhase("completed"))
      .catch((reason: unknown) => {
        setPhase("failed");
        setError(previewErrorMessage(reason));
      });
  };

  const save = () => {
    setError(null);
    void saveDraft()
      .then(() => toast.success("ライブラリに保存しました"))
      .catch((reason: unknown) => setError(generationErrorMessage(reason)));
  };

  const discard = () => {
    setError(null);
    void discardDraft().catch((reason: unknown) => setError(generationErrorMessage(reason)));
  };

  return (
    <Screen className="alchemy-screen">
      <header className="alchemy-header">
        <h1>どんな空間で集中する？</h1>
        <p>直感でムードを選び、あなただけの音楽を錬成します。</p>
      </header>

      <div className="alchemy-workspace">
        <MoodBoard
          activeCategory={activeCategory}
          recipe={recipe}
          editingDisabled={editingDisabled}
          onCategoryChange={setActiveCategory}
          onMoodToggle={toggleMood}
        />

        <section className="alchemy-orb-stage" aria-label="ムードを融合">
          <div className="alchemy-trails" aria-hidden="true">
            {recipe.moods.map((selection, index) => (
              <span
                key={selection.moodId}
                style={{ "--alchemy-trail-index": index } as React.CSSProperties}
              />
            ))}
          </div>
          <MoodOrb
            recipe={recipe}
            phase={phase}
            editingDisabled={editingDisabled}
            onWeightChange={(moodId, weight) => setRecipe((current) => rebalanceRecipeWeight(current, moodId, weight))}
          />
          <div className="alchemy-static-bands" aria-label="選択中のムード">
            {recipe.moods.map((selection) => (
              <span key={selection.moodId}>{MOOD_BY_ID.get(selection.moodId)?.label}</span>
            ))}
          </div>
        </section>

        <MusicRecipePanel
          recipe={recipe}
          draft={draft}
          phase={phase}
          error={error}
          playing={draftPlaying}
          onWeightChange={(moodId, weight) => setRecipe((current) => rebalanceRecipeWeight(current, moodId, weight))}
          onGenerate={generate}
          onCancel={cancelGeneration}
          onPreview={preview}
          onSave={save}
          onDiscard={discard}
          generating={generating}
          cancelling={cancelling}
          validating={validating}
          editingDisabled={editingDisabled}
          repairReceived={repairReceived}
          onRemoveMood={(moodId) => setRecipe((current) => removeMoodFromRecipe(current, moodId))}
        />
      </div>
    </Screen>
  );
}
