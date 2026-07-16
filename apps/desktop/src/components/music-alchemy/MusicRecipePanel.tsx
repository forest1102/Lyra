import { ArrowRightIcon, FlaskConicalIcon, PlayIcon, SaveIcon, SparklesIcon, SquareIcon, Trash2Icon, XIcon } from "lucide-react";
import type { MusicDraft } from "../../domain";
import { describeRecipe, type MusicRecipeV1 } from "../../services/moodCatalog";
import type { MusicGenerationPhase } from "../../services/musicGeneration";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MusicRecipePanelProps {
  recipe: MusicRecipeV1;
  draft: MusicDraft | null;
  phase: MusicGenerationPhase;
  error: string | null;
  playing: boolean;
  generating: boolean;
  cancelling: boolean;
  validating: boolean;
  editingDisabled: boolean;
  repairReceived: boolean;
  onWeightChange(moodId: string, weight: number): void;
  onRemoveMood(moodId: string): void;
  onGenerate(): void;
  onCancel(): void;
  onPreview(draft: MusicDraft): void;
  onSave(): void;
  onDiscard(): void;
}

function MoodWeightSlider({ label, value, disabled, onValueChange }: { label: string; value: number; disabled: boolean; onValueChange(value: number): void }) {
  return (
    <Slider
      aria-label={label}
      min={1}
      max={100}
      step={1}
      value={[value]}
      disabled={disabled}
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

interface StatusRow {
  label: string;
  active: boolean;
}

function generationStatusRows(phase: MusicGenerationPhase, repairReceived: boolean): StatusRow[] {
  switch (phase) {
    case "composing": return [{ label: "構成を組み立てています", active: true }];
    case "source_validating": return [
      { label: "構成を組み立てました", active: false },
      ...(repairReceived ? [{ label: "コードを修復しました", active: false }] : []),
      { label: "ChucKコードを検証しています", active: true },
    ];
    case "repairing": return [
      { label: "構成を組み立てました", active: false },
      { label: "ChucKコードを検証しました", active: false },
      { label: "コードを修復しています", active: true },
    ];
    case "ready": return [
      ...(repairReceived ? [{ label: "コードを修復しました", active: false }] : []),
      { label: "コードが完成しました。再生前に5秒検証してください", active: false },
    ];
    case "audio": return [{ label: "5秒の音声を検証しています", active: true }];
    case "deferred": return [{ label: "集中終了後の音声検証を待っています", active: false }];
    case "completed": return [{ label: "音声検証が完了しました", active: false }];
    default: return [];
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
  editingDisabled,
  repairReceived,
  onWeightChange,
  onRemoveMood,
  onGenerate,
  onCancel,
  onPreview,
  onSave,
  onDiscard,
}: MusicRecipePanelProps) {
  const selections = describeRecipe(recipe);
  const statuses = generationStatusRows(phase, repairReceived);
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

      <TooltipProvider>
        <div className="alchemy-weights">
          {selections.map(({ mood, moodId, weight }) => {
            const percent = Math.round(weight * 100);
            const weightFixed = selections.length === 1;
            const removeDisabled = editingDisabled || selections.length === 1;
            const removeReason = editingDisabled ? "生成中は編集できません" : selections.length === 1 ? "最後のムードです" : null;
            return (
              <div className="alchemy-weight" key={moodId}>
                <div className="alchemy-weight-meta">
                  <span><i style={{ "--mood-color": mood.color } as React.CSSProperties} />{mood.label}</span>
                  <div>
                    <strong>{percent}%</strong>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          role={removeReason ? "note" : undefined}
                          tabIndex={removeReason ? 0 : undefined}
                          aria-label={removeReason ? `${mood.label}を削除できません: ${removeReason}` : undefined}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={removeDisabled}
                            aria-label={`${mood.label}を削除`}
                            onClick={() => onRemoveMood(moodId)}
                          >
                            <XIcon data-icon="inline-start" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{removeReason ?? `${mood.label}を削除`}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <MoodWeightSlider
                  label={weightFixed ? `${mood.label}の重み。ムードが1つのため重みは100%に固定されています` : `${mood.label}の重み`}
                  value={percent}
                  disabled={editingDisabled || weightFixed}
                  onValueChange={(value) => onWeightChange(moodId, value / 100)}
                />
              </div>
            );
          })}
        </div>
      </TooltipProvider>

      {statuses.length > 0 ? (
        <div className="alchemy-status" aria-live="polite" aria-atomic="true">
          {statuses.map((status) => (
            <div key={status.label} data-active={status.active || undefined}>
              {status.active ? <Spinner /> : <i aria-hidden="true" />}
              <span>{status.label}</span>
            </div>
          ))}
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
