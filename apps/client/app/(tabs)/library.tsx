import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLyra } from "@/state/LyraContext";
import { Button, Card, PageHeader, Screen, uiStyles } from "@/ui/components";
import { colors } from "@/ui/theme";
import { previewErrorMessage, themeLabel } from "@/ui/labels";

export default function LibraryScreen() {
  const { tracks, previewTrack, rateTrack, toggleFavorite, saveVariation } = useLyra();
  const [codeTrackId, setCodeTrackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeTrack = tracks.find((track) => track.id === codeTrackId);

  return (
    <Screen>
      <PageHeader eyebrow="生成した音楽" title="ライブラリ" />
      {tracks.length === 0 ? (
        <Card style={styles.empty}>
          <Text style={styles.emptyGlyph}>♫</Text>
          <Text style={uiStyles.sectionTitle}>まだ保存曲がありません</Text>
          <Text style={uiStyles.body}>BGM制作で生成・試聴して保存すると、集中中に自由に切り替えられます。</Text>
        </Card>
      ) : tracks.map((track) => (
        <Card key={track.id}>
          <View style={styles.trackHeader}>
            <View style={{ flex: 1 }}>
              <Text style={uiStyles.label}>{themeLabel(track.theme)} · {track.bpm} BPM</Text>
              <Text style={styles.trackTitle}>{track.title}</Text>
              <Text style={uiStyles.body}>{track.description}</Text>
              {track.parentTrackId ? <Text style={styles.variation}>{tracks.find((parent) => parent.id === track.parentTrackId)?.title ?? "元の曲"} の変化版</Text> : null}
            </View>
            <Pressable onPress={() => toggleFavorite(track.id)}><Text style={styles.favorite}>{track.favorite ? "★" : "☆"}</Text></Pressable>
          </View>
          <View style={[uiStyles.row, { marginTop: 16 }]}>
            <Button label="▶ 再生" variant="secondary" onPress={() => {
              setError(null);
              void previewTrack(track.id).catch((reason: unknown) => {
                console.error(reason);
                setError(previewErrorMessage());
              });
            }} />
            <Button label="良い" variant="secondary" onPress={() => rateTrack(track.id, track.rating === "good" ? null : "good")} />
            <Button label="いまいち" variant="secondary" onPress={() => rateTrack(track.id, track.rating === "poor" ? null : "poor")} />
            <Button label="変化版を保存" variant="secondary" onPress={() => { void saveVariation(track.id, Math.floor(Math.random() * 2_147_483_647)); }} />
            <Button label="SCコード" variant="secondary" onPress={() => setCodeTrackId(track.id)} />
          </View>
        </Card>
      ))}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      {codeTrack ? (
        <Card style={{ borderColor: colors.violet }}>
          <View style={styles.trackHeader}>
            <Text style={uiStyles.sectionTitle}>{codeTrack.title} — SuperCollider</Text>
            <Button label="閉じる" variant="secondary" onPress={() => setCodeTrackId(null)} />
          </View>
          <Text selectable style={styles.code}>{`// 読み取り専用の生成コード\n// ${codeTrack.sourcePath}\n// SHA-256 ${codeTrack.sourceSha256}`}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", paddingVertical: 70 },
  emptyGlyph: { color: colors.violet, fontSize: 40, marginBottom: 14 },
  trackHeader: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
  trackTitle: { color: colors.text, fontSize: 22, fontWeight: "800", marginVertical: 6 },
  favorite: { color: colors.warning, fontSize: 30 },
  variation: { color: colors.violet, fontSize: 12, marginTop: 8 },
  code: { color: "#c8e6c9", backgroundColor: "#090b10", borderRadius: 10, padding: 16, fontFamily: "monospace", lineHeight: 20 }
});
