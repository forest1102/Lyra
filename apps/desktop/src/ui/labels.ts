import type { MusicArrangement, MusicIntensity, MusicTheme, TimerPhase, TimerPreset } from "../domain";
import type { MusicGenerationPhase } from "../services/musicGeneration";

const themes: Record<MusicTheme, string> = {
  "deep-space": "深宇宙",
  "rainy-cabin": "雨の小屋",
  "minimal-pulse": "ミニマル・パルス",
  "organic-drift": "有機的な漂流"
};
const intensities: Record<MusicIntensity, string> = { low: "低", medium: "中", high: "高" };
const arrangements: Record<MusicArrangement, string> = {
  ambient: "アンビエント",
  lofi: "Lo-fi",
  "minimal-melody": "ミニマル旋律"
};
const phases: Record<TimerPhase, string> = { focus: "集中", short_break: "短い休憩", long_break: "長い休憩" };
const builtInPresets: Record<string, string> = { sprint: "スプリント", standard: "スタンダード", "deep-focus": "深い集中" };

export const themeLabel = (theme: MusicTheme): string => themes[theme];
export const arrangementLabel = (arrangement: MusicArrangement): string => arrangements[arrangement];
export const intensityLabel = (intensity: MusicIntensity): string => intensities[intensity];
export const phaseLabel = (phase: TimerPhase): string => phases[phase];
export const presetLabel = (preset: TimerPreset): string => builtInPresets[preset.id] ?? preset.name;
export const generationErrorMessage = (reason?: unknown): string => {
  const detail = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "不明なエラー";
  return `BGMの生成に失敗しました: ${detail}`;
};
export const previewErrorMessage = (reason?: unknown): string => {
  const detail = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "不明なエラー";
  return detail.includes("5秒音声検証は合格しました") ? detail : `音声の検証に失敗しました: ${detail}`;
};

export function generationProgressLabel(phase: MusicGenerationPhase): string {
  switch (phase) {
    case "idle": return "";
    case "composing":
    case "source_validating":
    case "repairing": return "1/2 ChucKをコーディング中…";
    case "ready": return "コード生成完了。検証して再生を押してください。";
    case "audio": return "2/2 音声を生成・検証中…";
    case "deferred": return "コード生成完了。音声生成は集中終了後に再開できます。";
    case "completed": return "生成と音声検証が完了しました。試聴を再生しています。";
    case "failed": return "BGMの生成を完了できませんでした。";
  }
}
