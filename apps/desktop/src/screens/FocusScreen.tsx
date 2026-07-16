import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, Square, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/ui/empty";
import { Progress } from "../components/ui/progress";
import { Separator } from "../components/ui/separator";
import { useLyra } from "../state/LyraContext";
import { PageHeader, Screen } from "../ui/components";
import { phaseLabel, presetLabel } from "../ui/labels";

function clock(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function FocusScreen() {
  const lyra = useLyra();
  const [showComplete, setShowComplete] = useState(false);
  const [endBreakAfterRecord, setEndBreakAfterRecord] = useState(false);
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const selectedTasks = useMemo(() => lyra.tasks.filter((task) => !task.completed && lyra.selectedTaskIds.includes(task.id)), [lyra.selectedTaskIds, lyra.tasks]);
  const selectedTrack = lyra.tracks.find((track) => track.id === lyra.selectedTrackId);
  const active = ["running", "paused", "awaiting_break"].includes(lyra.timer.status);
  const breakStage = lyra.timer.phase !== "focus" || lyra.timer.status === "awaiting_break";
  const phaseSeconds = lyra.timer.phase === "focus"
    ? lyra.timer.preset.focusMinutes * 60
    : lyra.timer.phase === "short_break"
      ? lyra.timer.preset.shortBreakMinutes * 60
      : lyra.timer.preset.longBreakMinutes * 60;
  const progress = Math.max(0, Math.min(100, ((phaseSeconds - lyra.timer.remainingSeconds) / phaseSeconds) * 100));

  useEffect(() => {
    if (lyra.focusSessionId && (lyra.timer.status === "awaiting_break" || lyra.timer.phase !== "focus")) {
      setEndBreakAfterRecord(false);
      setShowComplete(true);
    }
  }, [lyra.focusSessionId, lyra.timer.phase, lyra.timer.status]);

  useEffect(() => {
    setCompletedTaskIds([]);
  }, [lyra.focusSessionId]);

  return (
    <Screen className="focus-screen">
      <PageHeader eyebrow="注意を守る" title="集中" />
      <div className="focus-layout">
        <section className="focus-main">
          <div className="focus-timer">
            <div className="focus-phase"><span>{phaseLabel(lyra.timer.phase)}</span><Badge variant="outline">{presetLabel(lyra.timer.preset)}</Badge></div>
            <time className="focus-clock" dateTime={`PT${lyra.timer.remainingSeconds}S`}>{clock(lyra.timer.remainingSeconds)}</time>
            <Progress value={progress} aria-label="集中の進捗" />
            <div className="focus-controls">
              {!active ? <Button size="lg" onClick={() => void lyra.dispatchTimer({ type: "start", nowMs: Date.now() })}><Play />集中を始める</Button> : null}
              {lyra.timer.status === "running" ? <Button variant="secondary" onClick={() => void lyra.dispatchTimer({ type: "pause", nowMs: Date.now() })}><Pause />一時停止</Button> : null}
              {lyra.timer.status === "paused" ? <Button onClick={() => void lyra.dispatchTimer({ type: "resume", nowMs: Date.now() })}><Play />再開</Button> : null}
              {lyra.timer.status === "awaiting_break" ? <Button onClick={() => void lyra.dispatchTimer({ type: "start_break", nowMs: Date.now() })}><RotateCcw />休憩を始める</Button> : null}
              {active ? <Button variant="ghost" onClick={() => { if (lyra.focusSessionId) { setEndBreakAfterRecord(breakStage); setShowComplete(true); } else void lyra.dispatchTimer({ type: "end", nowMs: Date.now() }).catch((error) => toast.error(error instanceof Error ? error.message : "タイマーを終了できませんでした")); }}><Square />{breakStage ? "休憩を終了" : "終了"}</Button> : null}
            </div>
            {!active ? <div className="focus-presets">{lyra.presets.map((candidate) => <button type="button" key={candidate.id} aria-pressed={lyra.preset.id === candidate.id} onClick={() => void lyra.selectPreset(candidate)}>{presetLabel(candidate)}<small>{candidate.focusMinutes}分</small></button>)}</div> : null}
          </div>

          <div className="focus-player">
            <div className="focus-player-art" aria-hidden="true"><span>{selectedTrack ? "♫" : "—"}</span></div>
            <div className="focus-player-copy">
              <span className="eyebrow">Music Alchemy</span>
              <h2>{selectedTrack?.title ?? "静かな集中"}</h2>
              <p>{selectedTrack?.description ?? "音楽を使わず、このまま集中できます。"}</p>
            </div>
            <div className="focus-track-options" aria-label="集中用の音楽">
              <button type="button" aria-pressed={!lyra.selectedTrackId} onClick={() => void lyra.selectTrack(null)}><VolumeX />無音</button>
              {lyra.tracks.slice(0, 3).map((track) => <button type="button" key={track.id} aria-pressed={lyra.selectedTrackId === track.id} onClick={() => void lyra.selectTrack(track.id)}><Volume2 />{track.title}</button>)}
            </div>
          </div>

          {lyra.musicPlayback.disabled ? (
            <Alert variant="destructive" className="focus-audio-alert">
              <VolumeX />
              <AlertTitle>BGMを一時停止しました</AlertTitle>
              <AlertDescription>集中セッションはそのまま継続しています。設定の「ランタイム」でWebChucKを診断してから、次の集中で再開できます。</AlertDescription>
            </Alert>
          ) : null}
        </section>

        <aside className="focus-tasks">
          <header><div><span className="eyebrow">今回の集中</span><h2>選択したタスク</h2></div><Badge>{lyra.selectedPomodoroTotal} Pomodoro</Badge></header>
          <Separator />
          {selectedTasks.length === 0 ? (
            <Empty>
              <EmptyHeader><EmptyMedia variant="icon">✓</EmptyMedia><EmptyTitle>タスクは未選択です</EmptyTitle><EmptyDescription>タスク画面で今日取り組む項目を選べます。</EmptyDescription></EmptyHeader>
            </Empty>
          ) : (
            <ol className="focus-task-list">
              {selectedTasks.map((task, index) => <li key={task.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{task.title}</strong><small>{task.estimatedPomodoros ?? 0} Pomodoro{task.projectId ? ` · ${lyra.projects?.find((project) => project.id === task.projectId)?.name ?? "Project"}` : ""}</small></div></li>)}
            </ol>
          )}
          <div className="focus-task-note">曲の変更・改名・削除やBGM障害が起きても、タイマーは停止しません。</div>
        </aside>
      </div>

      <Dialog open={showComplete} onOpenChange={(open) => { setShowComplete(open); if (!open) setEndBreakAfterRecord(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>今回完了したタスク</DialogTitle><DialogDescription>完了した項目だけを選び、集中記録と一緒に保存します。</DialogDescription></DialogHeader>
          <div className="focus-complete-list">
            {selectedTasks.map((task) => <label key={task.id}><Checkbox checked={completedTaskIds.includes(task.id)} onCheckedChange={(checked) => setCompletedTaskIds((current) => checked ? [...new Set([...current, task.id])] : current.filter((id) => id !== task.id))} />{task.title}</label>)}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => { setShowComplete(false); setEndBreakAfterRecord(false); }}>戻る</Button><Button onClick={() => { void lyra.endFocus(completedTaskIds).then(async () => { if (endBreakAfterRecord) await lyra.dispatchTimer({ type: "end", nowMs: Date.now() }); setCompletedTaskIds([]); setShowComplete(false); setEndBreakAfterRecord(false); }).catch((error) => toast.error(error instanceof Error ? error.message : "集中記録を保存できませんでした")); }}>記録して終了</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}
