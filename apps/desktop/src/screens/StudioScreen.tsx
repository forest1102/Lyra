import { useRef, useState } from "react";
import { MUSIC_ARRANGEMENTS, MUSIC_THEMES, type MusicArrangement, type MusicGenerationRequest, type MusicIntensity, type MusicTheme } from "../domain";
import { MusicGenerationPipelineError, runMusicGeneration, type MusicGenerationPhase } from "../services/musicGeneration";
import { useLyra } from "../state/LyraContext";
import { Button, Card, PageHeader, Pill, Screen } from "../ui/components";
import { arrangementLabel, generationErrorMessage, generationProgressLabel, intensityLabel, previewErrorMessage, themeLabel } from "../ui/labels";

const themeInfo: Record<MusicTheme, { glyph: string; description: string }> = {
  "deep-space": { glyph: "✦", description: "広い残響とゆっくりした倍音" },
  "rainy-cabin": { glyph: "⌇", description: "柔らかな雨と木質の響き" },
  "minimal-pulse": { glyph: "···", description: "控えめな反復と明確な脈動" },
  "organic-drift": { glyph: "⌁", description: "呼吸するような揺らぎ" }
};

function Control({ label, value, onChange }: { label: string; value: MusicIntensity; onChange: (value: MusicIntensity) => void }) {
  return <div className="stack compact"><span className="label">{label}</span><div className="row">{(["low", "medium", "high"] as const).map((candidate) => <Pill key={candidate} label={intensityLabel(candidate)} active={value === candidate} onPress={() => onChange(candidate)} />)}</div></div>;
}

function ArrangementControl({ value, onChange }: { value: MusicArrangement; onChange: (value: MusicArrangement) => void }) {
  return <div className="stack compact"><span className="label">曲調</span><div className="row">{MUSIC_ARRANGEMENTS.map((candidate) => <Pill key={candidate} label={arrangementLabel(candidate)} active={value === candidate} onPress={() => onChange(candidate)} />)}</div></div>;
}

export function StudioScreen() {
  const { draft, musicPlayback, generateTrack, cancelMusicGeneration, previewDraft, stopMusic, saveDraft, discardDraft } = useLyra();
  const [request, setRequest] = useState<MusicGenerationRequest>({ theme: "deep-space", arrangement: "ambient", brightness: "medium", density: "medium", motion: "low" });
  const [phase, setPhase] = useState<MusicGenerationPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const generating = phase === "coding" || phase === "audio";
  const draftPlaying = !!draft && musicPlayback.status === "playing" && musicPlayback.trackId === draft.id;

  const generate = () => {
    cancelled.current = false;
    setError(null);
    void runMusicGeneration({ request, generate: generateTrack, onPhase: setPhase }).catch((reason: unknown) => {
      if (cancelled.current) {
        cancelled.current = false;
        setPhase("idle");
        return;
      }
      setPhase("failed");
      setError(generationErrorMessage(reason instanceof MusicGenerationPipelineError ? reason.cause : reason));
    });
  };

  const cancelGeneration = () => {
    cancelled.current = true;
    setPhase("idle");
    setError(null);
    void cancelMusicGeneration().catch((reason) => {
      cancelled.current = false;
      setPhase("failed");
      setError(generationErrorMessage(reason));
    });
  };

  return (
    <Screen>
      <PageHeader eyebrow="制約から音楽をつくる" title="BGM制作" />
      <p>テーマ、曲調、3つの質感を選び、Codexが許可API内でChucKコードを生成します。音声はWebChucKでクライアント再生します。</p>
      <div className="theme-grid">{MUSIC_THEMES.map((theme) => <Card key={theme} className={`theme-card ${request.theme === theme ? "selected-card" : ""}`}><span className="theme-glyph">{themeInfo[theme].glyph}</span><h2>{themeLabel(theme)}</h2><p>{themeInfo[theme].description}</p><Pill label={request.theme === theme ? "選択中" : "選ぶ"} active={request.theme === theme} onPress={() => setRequest({ ...request, theme })} /></Card>)}</div>
      <Card>
        <ArrangementControl value={request.arrangement} onChange={(arrangement) => setRequest({ ...request, arrangement })} />
        <div className="split controls"><Control label="明るさ" value={request.brightness} onChange={(brightness) => setRequest({ ...request, brightness })} /><Control label="密度" value={request.density} onChange={(density) => setRequest({ ...request, density })} /><Control label="動き" value={request.motion} onChange={(motion) => setRequest({ ...request, motion })} /><Button label={phase === "coding" ? "生成を中止" : generating ? generationProgressLabel(phase) : "生成する"} variant={phase === "coding" ? "danger" : "primary"} disabled={phase === "audio"} onClick={phase === "coding" ? cancelGeneration : generate} /></div>
        {phase !== "idle" && phase !== "failed" ? <div className="progress" aria-live="polite"><div className="track-header"><strong>{generationProgressLabel(phase)}</strong><span className="eyebrow">{phase === "coding" ? "コード生成" : phase === "ready" ? "再生待ち" : phase === "audio" ? "音声処理" : phase === "deferred" ? "音声待機" : "完了"}</span></div><div className="progress-track"><span style={{ width: phase === "coding" || phase === "ready" || phase === "deferred" ? "50%" : "100%" }} /></div></div> : null}
        {error ? <p className="danger" role="alert">{error}</p> : null}
      </Card>
      {draft ? <Card className="selected-card"><span className="label">生成したBGM</span><h2>{draft.title}</h2><p>{draft.description}</p><div className="row"><span className="pill">{draft.bpm} BPM</span><span className="pill">余韻 {draft.tailSeconds}秒</span></div><div className="row"><Button label={phase === "audio" ? "音声を生成・検証中…" : draftPlaying ? "■ 停止" : draft.audioValidation === "passed" ? "▶ 再生" : "検証して再生"} variant="secondary" disabled={generating} onClick={() => { setError(null); if (draftPlaying) { void stopMusic().catch((reason) => setError(previewErrorMessage(reason))); return; } setPhase("audio"); void previewDraft(draft).then(() => setPhase("completed")).catch((reason) => { setPhase("failed"); setError(previewErrorMessage(reason)); }); }} /><Button label="ライブラリに保存" disabled={draft.audioValidation !== "passed"} onClick={() => void saveDraft()} /><Button label="破棄" variant="danger" disabled={generating} onClick={discardDraft} /></div>{draft.audioValidation === "deferred_until_focus_ends" ? <p className="warning">集中終了後に音声検証を再開できます。</p> : null}</Card> : null}
    </Screen>
  );
}
