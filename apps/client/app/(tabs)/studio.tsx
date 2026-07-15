import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MUSIC_ARRANGEMENTS, MUSIC_THEMES, type MusicArrangement, type MusicGenerationRequest, type MusicIntensity, type MusicTheme } from "@lyra/domain";
import { useLyra } from "@/state/LyraContext";
import { Button, Card, PageHeader, Pill, Screen, uiStyles } from "@/ui/components";
import { colors } from "@/ui/theme";
import {
  generationErrorMessage,
  generationProgressLabel,
  arrangementLabel,
  intensityLabel,
  previewErrorMessage,
  themeLabel
} from "@/ui/labels";
import {
  MusicGenerationPipelineError,
  runMusicGeneration,
  type MusicGenerationPhase
} from "@/services/musicGeneration";
import { DEFAULT_MUSIC_GENERATION_REQUEST } from "@/services/musicControls";

const themeInfo: Record<MusicTheme, { name: string; glyph: string; description: string }> = {
  "deep-space": { name: themeLabel("deep-space"), glyph: "✦", description: "広い残響とゆっくりした倍音" },
  "rainy-cabin": { name: themeLabel("rainy-cabin"), glyph: "⌇", description: "柔らかな雨と木質の響き" },
  "minimal-pulse": { name: themeLabel("minimal-pulse"), glyph: "···", description: "控えめな反復と明確な脈動" },
  "organic-drift": { name: themeLabel("organic-drift"), glyph: "⌁", description: "呼吸するような揺らぎ" }
};

function Control({ label, value, onChange }: { label: string; value: MusicIntensity; onChange: (value: MusicIntensity) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={uiStyles.label}>{label}</Text>
      <View style={uiStyles.row}>
        {(["low", "medium", "high"] as const).map((candidate) => (
          <Pill key={candidate} label={intensityLabel(candidate)} active={value === candidate} onPress={() => onChange(candidate)} />
        ))}
      </View>
    </View>
  );
}

function ArrangementControl({ value, onChange }: { value: MusicArrangement; onChange: (value: MusicArrangement) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={uiStyles.label}>曲調</Text>
      <View style={uiStyles.row}>
        {MUSIC_ARRANGEMENTS.map((candidate) => (
          <Pill key={candidate} label={arrangementLabel(candidate)} active={value === candidate} onPress={() => onChange(candidate)} />
        ))}
      </View>
    </View>
  );
}

export default function StudioScreen() {
  const { draft, generateTrack, previewDraft, saveDraft, discardDraft } = useLyra();
  const [request, setRequest] = useState<MusicGenerationRequest>(DEFAULT_MUSIC_GENERATION_REQUEST);
  const [generationPhase, setGenerationPhase] = useState<MusicGenerationPhase>("idle");
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generating = generationPhase === "coding" || generationPhase === "audio";
  const progressLabel = generationProgressLabel(generationPhase);

  return (
    <Screen>
      <PageHeader eyebrow="制約から音楽をつくる" title="BGM制作" />
      <Text style={uiStyles.body}>テーマ、曲調、3つの質感を選び、Codexが許可API内でSuperColliderコードを生成します。タイマーとは独立しています。</Text>
      <View style={styles.themeGrid}>
        {MUSIC_THEMES.map((theme) => {
          const info = themeInfo[theme];
          const selected = request.theme === theme;
          return (
            <Card key={theme} style={[styles.themeCard, selected ? styles.themeSelected : {}]}>
              <Text style={styles.glyph}>{info.glyph}</Text>
              <Text style={styles.themeName}>{info.name}</Text>
              <Text style={uiStyles.body}>{info.description}</Text>
              <View style={{ marginTop: 14 }}><Pill label={selected ? "選択中" : "選ぶ"} active={selected} onPress={() => setRequest({ ...request, theme })} /></View>
            </Card>
          );
        })}
      </View>
      <Card>
        <View style={{ marginBottom: 18 }}>
          <ArrangementControl value={request.arrangement} onChange={(arrangement) => setRequest({ ...request, arrangement })} />
        </View>
        <View style={[uiStyles.split, { justifyContent: "space-between" }]}>
          <Control label="明るさ" value={request.brightness} onChange={(brightness) => setRequest({ ...request, brightness })} />
          <Control label="密度" value={request.density} onChange={(density) => setRequest({ ...request, density })} />
          <Control label="動き" value={request.motion} onChange={(motion) => setRequest({ ...request, motion })} />
          <Button label={generating ? progressLabel : "生成する"} disabled={generating} onPress={() => {
            setError(null);
            void runMusicGeneration({
              request,
              generate: generateTrack,
              preview: previewDraft,
              onPhase: setGenerationPhase
            })
              .catch((reason: unknown) => {
                console.error(reason);
                setGenerationPhase("failed");
                setError(
                  reason instanceof MusicGenerationPipelineError && reason.stage === "audio"
                    ? previewErrorMessage()
                    : generationErrorMessage()
                );
              });
          }} />
        </View>
        {generationPhase !== "idle" && generationPhase !== "failed" ? (
          <View style={styles.progress} accessibilityLiveRegion="polite">
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>{progressLabel}</Text>
              <Text style={styles.progressStep}>
                {generationPhase === "coding"
                  ? "コード生成"
                  : generationPhase === "audio"
                    ? "音声処理"
                    : generationPhase === "deferred"
                      ? "音声待機"
                      : "完了"}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[
                styles.progressFill,
                { width: generationPhase === "coding" || generationPhase === "deferred" ? "50%" : "100%" }
              ]} />
            </View>
          </View>
        ) : null}
        {generationPhase === "failed" && error ? <Text style={{ color: colors.danger, marginTop: 14 }}>{error}</Text> : null}
      </Card>
      {draft ? (
        <Card style={styles.preview}>
          <Text style={uiStyles.label}>生成したBGM</Text>
          <Text style={styles.previewTitle}>{draft.title}</Text>
          <Text style={uiStyles.body}>{draft.description}</Text>
          <View style={[uiStyles.row, { marginTop: 16 }]}>
            <Pill label={`${draft.bpm} BPM`} active={false} onPress={() => {}} />
            <Pill label={`余韻 ${draft.tailSeconds}秒`} active={false} onPress={() => {}} />
          </View>
          <View style={[uiStyles.row, { marginTop: 18 }]}>
            <Button label={previewing || generationPhase === "audio" ? "音声を生成・検証中…" : draft.audioValidation === "passed" ? "▶ もう一度試聴" : "検証して試聴"} variant="secondary" disabled={previewing || generating} onPress={() => {
              setPreviewing(true);
              setGenerationPhase("audio");
              setError(null);
              void previewDraft(draft).then(() => {
                setGenerationPhase("completed");
              }).catch((reason: unknown) => {
                console.error(reason);
                setGenerationPhase("failed");
                setError(previewErrorMessage());
              }).finally(() => setPreviewing(false));
            }} />
            <Button label="ライブラリに保存" disabled={draft.audioValidation !== "passed"} onPress={() => { void saveDraft(); }} />
            <Button label="破棄" variant="danger" disabled={previewing || generating} onPress={discardDraft} />
          </View>
          {draft.audioValidation === "deferred_until_focus_ends" ? <Text style={[uiStyles.body, { color: colors.warning, marginTop: 12 }]}>集中終了後に音声検証を再開できます。</Text> : null}
          {generationPhase !== "failed" && error ? <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text> : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  themeCard: { flex: 1, minWidth: 210 },
  themeSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  glyph: { color: colors.violet, fontSize: 30, marginBottom: 18 },
  themeName: { color: colors.text, fontSize: 18, fontWeight: "800", marginBottom: 6 },
  preview: { borderColor: colors.violet },
  previewTitle: { color: colors.text, fontSize: 26, fontWeight: "800", marginVertical: 8 },
  progress: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 18,
    padding: 14
  },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  progressTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  progressStep: { color: colors.accent, fontSize: 12, fontWeight: "800" },
  progressTrack: { backgroundColor: colors.panelRaised, borderRadius: 999, height: 6, marginTop: 12, overflow: "hidden" },
  progressFill: { backgroundColor: colors.accent, borderRadius: 999, height: "100%" }
});
