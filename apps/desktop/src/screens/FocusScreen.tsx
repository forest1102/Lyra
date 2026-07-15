import { useEffect, useMemo, useState } from "react";
import { useLyra } from "../state/LyraContext";
import { Button, Card, PageHeader, Pill, Screen } from "../ui/components";
import { phaseLabel, presetLabel } from "../ui/labels";

function clock(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function FocusScreen() {
  const lyra = useLyra();
  const [showComplete, setShowComplete] = useState(false);
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const activeTasks = useMemo(() => lyra.tasks.filter((task) => !task.completed), [lyra.tasks]);
  const selectedTrack = lyra.tracks.find((track) => track.id === lyra.selectedTrackId);
  const active = ["running", "paused", "awaiting_break"].includes(lyra.timer.status);

  useEffect(() => {
    if (lyra.timer.status === "awaiting_break" && lyra.focusSessionId) setShowComplete(true);
  }, [lyra.focusSessionId, lyra.timer.status]);

  return (
    <Screen>
      <PageHeader eyebrow="注意を守る" title="集中" />
      <div className="split">
        <Card className="timer-card">
          <span className="eyebrow">{phaseLabel(lyra.timer.phase)}</span>
          <div className="clock">{clock(lyra.timer.remainingSeconds)}</div>
          <div className="row centered">
            {!active ? <Button label="集中を始める" onClick={() => void lyra.dispatchTimer({ type: "start", nowMs: Date.now() })} /> : null}
            {lyra.timer.status === "running" ? <Button label="一時停止" variant="secondary" onClick={() => void lyra.dispatchTimer({ type: "pause", nowMs: Date.now() })} /> : null}
            {lyra.timer.status === "paused" ? <Button label="再開" onClick={() => void lyra.dispatchTimer({ type: "resume", nowMs: Date.now() })} /> : null}
            {lyra.timer.status === "awaiting_break" ? <Button label="休憩を始める" onClick={() => void lyra.dispatchTimer({ type: "start_break", nowMs: Date.now() })} /> : null}
            {active ? <Button label="終了" variant="danger" onClick={() => setShowComplete(true)} /> : null}
          </div>
            {!active ? <div className="row centered preset-row">{lyra.presets.map((candidate) => <Pill key={candidate.id} label={`${presetLabel(candidate)} ${candidate.focusMinutes}分`} active={lyra.preset.id === candidate.id} onPress={() => void lyra.selectPreset(candidate)} />)}</div> : null}
        </Card>
        <Card className="focus-side-card">
          <span className="label">選択したタスク</span><strong className="side-count">{lyra.selectedTaskIds.length}件</strong>
          <div className="stack compact">
            {activeTasks.length === 0 ? <p>タスク画面から作業を追加できます。</p> : activeTasks.map((task) => (
              <button className="select-row" key={task.id} disabled={active} onClick={() => lyra.selectTask(task.id)}>
                <span className={`select-dot ${lyra.selectedTaskIds.includes(task.id) ? "select-dot-active" : ""}`} />{task.title}
              </button>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <div className="track-header"><div><span className="label">再生中</span><h2>{selectedTrack?.title ?? "無音"}</h2><p>{lyra.variationSeed ? `バリエーション・シード ${lyra.variationSeed}` : selectedTrack ? "標準シード" : "音楽なしでも集中できます"}</p></div><span className="wave">⌁⌁⌁</span></div>
        <div className="row">
          <Pill label="無音" active={!lyra.selectedTrackId} onPress={() => void lyra.selectTrack(null)} />
          {lyra.tracks.map((track) => <div className="row" key={track.id}><Pill label={track.title} active={lyra.selectedTrackId === track.id && !lyra.variationSeed} onPress={() => void lyra.selectTrack(track.id)} /><Pill label="変化版" active={lyra.selectedTrackId === track.id && !!lyra.variationSeed} onPress={() => void lyra.selectTrack(track.id, true)} /></div>)}
        </div>
        <p>切替時はタイマーを止めず、待機Deckへロードして約2秒でクロスフェードします。</p>
      </Card>
      {showComplete ? (
        <Card className="complete-card">
          <h2>今回完了したタスク</h2>
          {lyra.selectedTaskIds.map((id) => {
            const task = lyra.tasks.find((candidate) => candidate.id === id);
            return task ? <button className="select-row" key={id} onClick={() => setCompletedTaskIds((current) => current.includes(id) ? current.filter((taskId) => taskId !== id) : [...current, id])}><span className={`select-dot ${completedTaskIds.includes(id) ? "select-dot-active" : ""}`} />{task.title}</button> : null;
          })}
          <div className="row"><Button label="記録して終了" onClick={() => { void lyra.endFocus(completedTaskIds); setShowComplete(false); }} /><Button label="戻る" variant="secondary" onClick={() => setShowComplete(false)} /></div>
        </Card>
      ) : null}
    </Screen>
  );
}
