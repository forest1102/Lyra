import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLyra } from "@/state/LyraContext";
import { Button, Card, PageHeader, Pill, Screen, uiStyles } from "@/ui/components";
import { colors } from "@/ui/theme";
import { phaseLabel, presetLabel } from "@/ui/labels";

function clock(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function FocusScreen() {
  const lyra = useLyra();
  const [showComplete, setShowComplete] = useState(false);
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const activeTasks = useMemo(() => lyra.tasks.filter((task) => !task.completed), [lyra.tasks]);
  const selectedTrack = lyra.tracks.find((track) => track.id === lyra.selectedTrackId);
  const active = ["running", "paused", "awaiting_break"].includes(lyra.timer.status);

  useEffect(() => {
    if (lyra.timer.status === "awaiting_break" && lyra.focusSessionId) {
      setShowComplete(true);
    }
  }, [lyra.timer.status, lyra.focusSessionId]);

  return (
    <Screen>
      <PageHeader eyebrow="注意を守る" title="集中" />
      <View style={uiStyles.split}>
        <Card style={styles.timerCard}>
          <Text style={styles.phase}>{phaseLabel(lyra.timer.phase)}</Text>
          <Text style={styles.clock}>{clock(lyra.timer.remainingSeconds)}</Text>
          <View style={[uiStyles.row, { justifyContent: "center" }]}>
            {!active ? (
              <Button label="集中を始める" onPress={() => void lyra.dispatchTimer({ type: "start", nowMs: Date.now() })} />
            ) : null}
            {lyra.timer.status === "running" ? (
              <Button label="一時停止" variant="secondary" onPress={() => void lyra.dispatchTimer({ type: "pause", nowMs: Date.now() })} />
            ) : null}
            {lyra.timer.status === "paused" ? (
              <Button label="再開" onPress={() => void lyra.dispatchTimer({ type: "resume", nowMs: Date.now() })} />
            ) : null}
            {lyra.timer.status === "awaiting_break" ? (
              <Button label="休憩を始める" onPress={() => void lyra.dispatchTimer({ type: "start_break", nowMs: Date.now() })} />
            ) : null}
            {active ? <Button label="終了" variant="danger" onPress={() => setShowComplete(true)} /> : null}
          </View>
          {!active ? (
            <View style={[uiStyles.row, { justifyContent: "center", marginTop: 22 }]}>
              {lyra.presets.map((candidate) => (
                <Pill key={candidate.id} label={`${presetLabel(candidate)} ${candidate.focusMinutes}分`} active={lyra.preset.id === candidate.id} onPress={() => lyra.selectPreset(candidate)} />
              ))}
            </View>
          ) : null}
        </Card>
        <Card style={styles.sideCard}>
          <Text style={uiStyles.label}>選択したタスク</Text>
          <Text style={styles.sideCount}>{lyra.selectedTaskIds.length}件</Text>
          <View style={{ gap: 8, marginTop: 13 }}>
            {activeTasks.length === 0 ? <Text style={uiStyles.body}>タスク画面から作業を追加できます。</Text> : activeTasks.map((task) => (
              <Pressable key={task.id} disabled={active} onPress={() => lyra.selectTask(task.id)} style={styles.selectRow}>
                <View style={[styles.selectDot, lyra.selectedTaskIds.includes(task.id) && styles.selectDotActive]} />
                <Text style={styles.selectLabel}>{task.title}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      </View>
      <Card>
        <View style={styles.musicHeader}>
          <View>
            <Text style={uiStyles.label}>再生中</Text>
            <Text style={styles.musicTitle}>{selectedTrack?.title ?? "無音"}</Text>
            <Text style={uiStyles.body}>{lyra.variationSeed ? `バリエーション・シード ${lyra.variationSeed}` : selectedTrack ? "標準シード" : "音楽なしでも集中できます"}</Text>
          </View>
          <Text style={styles.wave}>⌁⌁⌁</Text>
        </View>
        <View style={[uiStyles.row, { marginTop: 18 }]}>
          <Pill label="無音" active={!lyra.selectedTrackId} onPress={() => void lyra.selectTrack(null)} />
          {lyra.tracks.map((track) => (
            <View key={track.id} style={uiStyles.row}>
              <Pill label={track.title} active={lyra.selectedTrackId === track.id && !lyra.variationSeed} onPress={() => void lyra.selectTrack(track.id)} />
              <Pill label="変化版" active={lyra.selectedTrackId === track.id && !!lyra.variationSeed} onPress={() => void lyra.selectTrack(track.id, true)} />
            </View>
          ))}
        </View>
        <Text style={[uiStyles.body, { marginTop: 14 }]}>切替時はタイマーを止めず、待機Deckへロードして約2秒でクロスフェードします。</Text>
      </Card>
      {showComplete ? (
        <Card style={styles.completeCard}>
          <Text style={uiStyles.sectionTitle}>今回完了したタスク</Text>
          {lyra.selectedTaskIds.map((id) => {
            const task = lyra.tasks.find((candidate) => candidate.id === id);
            if (!task) return null;
            return (
              <Pressable key={id} onPress={() => setCompletedTaskIds((current) => current.includes(id) ? current.filter((taskId) => taskId !== id) : [...current, id])} style={styles.selectRow}>
                <View style={[styles.selectDot, completedTaskIds.includes(id) && styles.selectDotActive]} />
                <Text style={styles.selectLabel}>{task.title}</Text>
              </Pressable>
            );
          })}
          <View style={[uiStyles.row, { marginTop: 16 }]}>
            <Button label="記録して終了" onPress={() => { void lyra.endFocus(completedTaskIds); setShowComplete(false); }} />
            <Button label="戻る" variant="secondary" onPress={() => setShowComplete(false)} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  timerCard: { flex: 2, minWidth: 430, alignItems: "center", paddingVertical: 42 },
  sideCard: { flex: 1, minWidth: 280 },
  phase: { color: colors.accent, fontSize: 12, textTransform: "uppercase", letterSpacing: 2, fontWeight: "800" },
  clock: { color: colors.text, fontSize: 92, fontWeight: "700", letterSpacing: -5, fontVariant: ["tabular-nums"], marginVertical: 16 },
  sideCount: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 5 },
  selectRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  selectDot: { width: 18, height: 18, borderRadius: 6, borderColor: colors.muted, borderWidth: 1 },
  selectDotActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  selectLabel: { color: colors.text, fontSize: 14, flex: 1 },
  musicHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  musicTitle: { color: colors.text, fontSize: 24, fontWeight: "800", marginVertical: 5 },
  wave: { color: colors.violet, fontSize: 36, letterSpacing: 5 },
  completeCard: { borderColor: colors.accent },
});
