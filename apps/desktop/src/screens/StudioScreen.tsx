import { useState } from "react";
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
import { isActiveGenerationPhase } from "../services/musicGeneration";
import { useLyra } from "../state/LyraContext";
import { generationErrorMessage, previewErrorMessage } from "../ui/labels";
import { Screen } from "../ui/components";
import "./StudioScreen.css";

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
    musicGeneration,
    musicPlayback,
    setMusicRecipe,
    startMusicGeneration,
    cancelMusicGeneration,
    previewMusicDraft,
    stopMusic,
    saveDraft,
    discardDraft,
  } = useLyra();
  const [activeCategory, setActiveCategory] = useState(MOOD_CATALOG.categories[0].id);
  const [recipe, setRecipe] = useState<MusicRecipeV1>(() => musicGeneration.recipe);
  const [actionError, setActionError] = useState<string | null>(null);
  const { phase, cancelling, repairReceived, error } = musicGeneration;
  const generating = isActiveGenerationPhase(phase);
  const validating = phase === "audio";
  const editingDisabled = generating || cancelling;
  const draftPlaying = Boolean(draft && musicPlayback.status === "playing" && musicPlayback.trackId === draft.id);

  const updateRecipe = (next: MusicRecipeV1) => {
    setRecipe(next);
    setMusicRecipe(next);
  };

  const toggleMood = (moodId: string) => {
    const ids = recipe.moods.map((mood) => mood.moodId);
    if (ids.includes(moodId)) {
      if (ids.length === 1) {
        toast.info("ムードは1つ以上選んでください");
        return;
      }
      updateRecipe(createMusicRecipe(ids.filter((id) => id !== moodId)));
      return;
    }
    if (ids.length >= 5) {
      toast.info("選べるムードは5つまでです");
      return;
    }
    updateRecipe(createMusicRecipe([...ids, moodId]));
  };

  const generate = () => {
    setActionError(null);
    void startMusicGeneration(recipe);
  };

  const cancelGeneration = () => {
    setActionError(null);
    void cancelMusicGeneration().catch(() => undefined);
  };

  const preview = (target: MusicDraft) => {
    setActionError(null);
    if (draftPlaying) {
      void stopMusic().catch((reason: unknown) => setActionError(previewErrorMessage(reason)));
      return;
    }
    void previewMusicDraft(target);
  };

  const save = () => {
    setActionError(null);
    void saveDraft()
      .then(() => toast.success("ライブラリに保存しました"))
      .catch((reason: unknown) => setActionError(generationErrorMessage(reason)));
  };

  const discard = () => {
    setActionError(null);
    void discardDraft().catch((reason: unknown) => setActionError(generationErrorMessage(reason)));
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
            onWeightChange={(moodId, weight) => updateRecipe(rebalanceRecipeWeight(recipe, moodId, weight))}
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
          error={actionError ?? error}
          playing={draftPlaying}
          onWeightChange={(moodId, weight) => updateRecipe(rebalanceRecipeWeight(recipe, moodId, weight))}
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
          onRemoveMood={(moodId) => updateRecipe(removeMoodFromRecipe(recipe, moodId))}
        />
      </div>
    </Screen>
  );
}
