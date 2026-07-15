import { useState } from "react";
import { useLyra } from "../state/LyraContext";
import { Button, Card, PageHeader, Screen } from "../ui/components";
import { previewErrorMessage, themeLabel } from "../ui/labels";

export function LibraryScreen() {
  const { tracks, musicPlayback, previewTrack, stopMusic, rateTrack, toggleFavorite, saveVariation, loadTrackSource } = useLyra();
  const [codeTrackId, setCodeTrackId] = useState<string | null>(null);
  const [codeSource, setCodeSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeTrack = tracks.find((track) => track.id === codeTrackId);
  return (
    <Screen>
      <PageHeader eyebrow="生成した音楽" title="ライブラリ" />
      {tracks.length === 0 ? <Card className="empty"><span className="empty-glyph">♫</span><h2>まだ保存曲がありません</h2><p>BGM制作で生成・試聴して保存すると、集中中に自由に切り替えられます。</p></Card> : tracks.map((track) => (
        <Card key={track.id}>
          <div className="track-header"><div className="grow"><span className="label">{themeLabel(track.theme)} · {track.bpm} BPM</span><h2>{track.title}</h2><p>{track.description}</p>{track.parentTrackId ? <small className="violet">{tracks.find((parent) => parent.id === track.parentTrackId)?.title ?? "元の曲"} の変化版</small> : null}</div><button className="favorite" aria-label="お気に入り" onClick={() => void toggleFavorite(track.id)}>{track.favorite ? "★" : "☆"}</button></div>
          <div className="row"><Button label={musicPlayback.status === "playing" && musicPlayback.trackId === track.id ? "■ 停止" : "▶ 再生"} variant="secondary" onClick={() => { setError(null); const action = musicPlayback.status === "playing" && musicPlayback.trackId === track.id ? stopMusic() : previewTrack(track.id); void action.catch((reason) => setError(previewErrorMessage(reason))); }} /><Button label="良い" variant="secondary" onClick={() => void rateTrack(track.id, track.rating === "good" ? null : "good")} /><Button label="いまいち" variant="secondary" onClick={() => void rateTrack(track.id, track.rating === "poor" ? null : "poor")} /><Button label="変化版を保存" variant="secondary" onClick={() => void saveVariation(track.id, Math.floor(Math.random() * 2_147_483_647))} /><Button label="ChucKコード" variant="secondary" onClick={() => { setError(null); setCodeTrackId(track.id); setCodeSource(null); void loadTrackSource(track.id).then(setCodeSource).catch(() => setError("ChucKソースの整合性を確認できませんでした。")); }} /></div>
        </Card>
      ))}
      {error ? <p className="danger" role="alert">{error}</p> : null}
      {codeTrack ? <Card className="code-card"><div className="track-header"><h2>{codeTrack.title} — ChucK</h2><Button label="閉じる" variant="secondary" onClick={() => { setCodeTrackId(null); setCodeSource(null); }} /></div><pre>{codeSource ?? "検証済みソースを読み込み中…"}</pre><small>{codeTrack.sourcePath} · SHA-256 {codeTrack.sourceSha256}</small></Card> : null}
    </Screen>
  );
}
