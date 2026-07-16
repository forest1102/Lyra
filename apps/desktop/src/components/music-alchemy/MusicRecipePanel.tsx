import { ArrowRightIcon, FlaskConicalIcon, PlayIcon, SaveIcon, SparklesIcon, SquareIcon, Trash2Icon } from "lucide-react";
import type { MusicDraft } from "../../domain";
import { describeRecipe, type MusicRecipeV1 } from "../../services/moodCatalog";
import { isActiveGenerationPhase, type MusicGenerationPhase } from "../../services/musicGeneration";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";

interface MusicRecipePanelProps {
  recipe: MusicRecipeV1;
  draft: MusicDraft | null;
  phase: MusicGenerationPhase;
  error: string | null;
  playing: boolean;
  generating: boolean;
  cancelling: boolean;
  validating: boolean;
  onWeightChange(moodId: string, weight: number): void;
  onGenerate(): void;
  onCancel(): void;
  onPreview(draft: MusicDraft): void;
  onSave(): void;
  onDiscard(): void;
}

function MoodWeightSlider({ label, value, onValueChange }: { label: string; value: number; onValueChange(value: number): void }) {
  return (
    <Slider
      aria-label={label}
      min={1}
      max={99}
      step={1}
      value={[value]}
      onValueChange={(next) => onValueChange(next[0])}
    />
  );
}

function recipeFeeling(recipe: MusicRecipeV1): string {
  const selections = describeRecipe(recipe);
  const score = (key: "space" | "warmth" | "motion" | "melody") => selections.reduce(
    (total, selection) => total + selection.mood.vectors[key] * selection.weight,
    0,
  );
  const opening = score("space") > 0.72 ? "遠くまで広がる余白に" : "親密な音の輪郭に";
  const texture = score("warmth") > 0.62 ? "暖かな残響" : "澄んだ残響";
  const movement = score("motion") > 0.48 ? "静かな推進力" : "浮遊する旋律";
  return `${opening}、${texture}と${movement}`;
}

function progressDetail(phase: MusicGenerationPhase): { label: string; value: number } | null {
  switch (phase) {
    case "composing":
    case "source_validating":
    case "repairing": return { label: "ChucKをコーディングしています", value: 34 };
    case "ready": return { label: "コードが完成しました。再生前に5秒検証してください", value: 66 };
    case "audio": return { label: "5秒の音声を検証しています", value: 82 };
    case "deferred": return { label: "集中終了後の音声検証を待っています", value: 66 };
    case "completed": return { label: "音声検証が完了しました", value: 100 };
    default: return null;
  }
}

export function MusicRecipePanel({
  recipe,
  draft,
  phase,
  error,
  playing,
  generating,
  cancelling,
  validating,
  onWeightChange,
  onGenerate,
  onCancel,
  onPreview,
  onSave,
  onDiscard,
}: MusicRecipePanelProps) {
  const selections = describeRecipe(recipe);
  const progress = progressDetail(phase);
  const deferred = draft?.audioValidation === "deferred_until_focus_ends";
  const validated = draft?.audioValidation === "passed";

  return (
    <aside className="alchemy-recipe" aria-label="生成する音楽のレシピ">
      <div className="alchemy-section-heading">
        <span>生成される音楽のレシピ</span>
        <Badge variant="outline">{selections.length} moods</Badge>
      </div>

      <div className="alchemy-recipe-intro">
        <SparklesIcon aria-hidden="true" />
        {generating ? (
          <div className="alchemy-recipe-skeleton" aria-label="レシピを生成中">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : (
          <h2>{draft?.title ?? recipeFeeling(recipe)}</h2>
        )}
        <p>{draft?.description ?? "選んだ風景・質感・温度を、集中を妨げないChucKの響きへ変換します。"}</p>
      </div>

      <div className="alchemy-weights">
        {selections.map(({ mood, moodId, weight }) => {
          const percent = Math.round(weight * 100);
          return (
            <div className="alchemy-weight" key={moodId}>
              <div className="alchemy-weight-meta">
                <span><i style={{ "--mood-color": mood.color } as React.CSSProperties} />{mood.label}</span>
                <strong>{percent}%</strong>
              </div>
              <MoodWeightSlider
                label={`${mood.label}の重み`}
                value={percent}
                onValueChange={(value) => onWeightChange(moodId, value / 100)}
              />
            </div>
          );
        })}
      </div>

      {progress ? (
        <div className="alchemy-progress" aria-live="polite">
          <div>{isActiveGenerationPhase(phase) || phase === "audio" ? <Spinner /> : <FlaskConicalIcon aria-hidden="true" />}<span>{progress.label}</span></div>
          <Progress value={progress.value} aria-label="音楽生成の進捗" />
        </div>
      ) : null}

      {deferred ? (
        <Alert>
          <FlaskConicalIcon aria-hidden="true" />
          <AlertTitle>音声検証を延期しています</AlertTitle>
          <AlertDescription>集中セッションを止めず、終了後に5秒の音声検証を再開します。</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Music Alchemyを完了できませんでした</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {draft ? (
        <div className="alchemy-draft-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={generating || validating || deferred}
            onClick={() => onPreview(draft)}
          >
            {playing ? <SquareIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
            {deferred ? "集中終了後に検証" : validating ? "5秒検証中" : playing ? "停止" : validated ? "再生" : "検証して再生"}
          </Button>
          <div>
            <Button type="button" variant="outline" disabled={!validated || generating || validating} onClick={onSave}>
              <SaveIcon data-icon="inline-start" />
              ライブラリに保存
            </Button>
            <Button type="button" variant="ghost" disabled={generating || validating} aria-label="生成した曲を破棄" onClick={onDiscard}>
              <Trash2Icon />
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        className="alchemy-generate"
        variant={generating ? "destructive" : "default"}
        disabled={validating || cancelling}
        onClick={generating ? onCancel : onGenerate}
      >
        {generating ? <SquareIcon data-icon="inline-start" /> : null}
        {cancelling ? "中止しています" : generating ? "生成を中止" : "このムードで生成"}
        {generating ? null : <ArrowRightIcon data-icon="inline-end" />}
      </Button>
    </aside>
  );
}
