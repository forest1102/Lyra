import {
  BUILTIN_PRESETS,
  createTask,
  createTimer,
  transitionTimer,
  type MusicGenerationRequest,
  type MusicDraft,
  type MusicTrack,
  type Task,
  type TaskList,
  type TimerEvent,
  type TimerPreset,
  type TimerState
} from "@lyra/domain";
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import { desktopBridge } from "@/services/desktop";
import { selectionPlaybackAction } from "@/services/desktop";
import { browserPreviewBpm } from "@/services/musicControls";
import { playBrowserPreview, stopBrowserPreview } from "@/services/webAudio";

interface LyraState {
  tasks: Task[];
  tracks: MusicTrack[];
  draft: MusicDraft | null;
  timer: TimerState;
  presets: TimerPreset[];
  preset: TimerPreset;
  selectedTaskIds: string[];
  selectedTrackId: string | null;
  variationSeed: number | null;
  focusSessionId: string | null;
  addTask(title: string, list: TaskList, estimate?: number): Promise<void>;
  toggleTask(id: string): Promise<void>;
  moveTask(id: string, list: TaskList): Promise<void>;
  selectTask(id: string): void;
  selectPreset(preset: TimerPreset): void;
  savePreset(preset: TimerPreset): Promise<void>;
  generateTrack(request: MusicGenerationRequest): Promise<MusicDraft>;
  previewDraft(target: MusicDraft): Promise<MusicDraft>;
  saveDraft(): Promise<void>;
  discardDraft(): void;
  selectTrack(id: string | null, variation?: boolean): Promise<void>;
  previewTrack(id: string): Promise<void>;
  dispatchTimer(event: TimerEvent): Promise<void>;
  endFocus(completedTaskIds: string[]): Promise<void>;
  rateTrack(id: string, rating: "good" | "poor" | null): void;
  toggleFavorite(id: string): void;
  saveVariation(id: string, seed: number): Promise<void>;
}

const LyraContext = createContext<LyraState | null>(null);

function generatedFixture(request: MusicGenerationRequest): MusicDraft {
  const id = crypto.randomUUID();
  const labels = {
    "deep-space": "深宇宙",
    "rainy-cabin": "雨の小屋",
    "minimal-pulse": "ミニマル・パルス",
    "organic-drift": "有機的な漂流"
  } as const;
  return {
    id,
    parentTrackId: null,
    title: `${labels[request.theme]} ${Math.floor(Math.random() * 90 + 10)}`,
    description: "Codexが制約付きSuperColliderパターンとして生成したフォーカスBGMです。",
    ...request,
    bpm: browserPreviewBpm(request.arrangement, request.motion),
    tailSeconds: 4,
    supercolliderSource: "(~lyraTrack = (synthDefs: [], pattern: Pseq([1], inf));)",
    sourceSha256: "preview",
    canonicalSeed: Math.floor(Math.random() * 2_147_483_647),
    audioValidation: "passed"
  };
}

export function LyraProvider({ children }: PropsWithChildren) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [draft, setDraft] = useState<MusicDraft | null>(null);
  const [preset, setPreset] = useState<TimerPreset>(BUILTIN_PRESETS[1]);
  const [presets, setPresets] = useState<TimerPreset[]>([...BUILTIN_PRESETS]);
  const [timer, setTimer] = useState<TimerState>(() => createTimer(BUILTIN_PRESETS[1]));
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [variationSeed, setVariationSeed] = useState<number | null>(null);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopBridge.available()) return;
    void Promise.all([desktopBridge.listTasks(), desktopBridge.listTracks(), desktopBridge.listTimerPresets()]).then(([nextTasks, nextTracks, nextPresets]) => {
      setTasks(nextTasks);
      setTracks(nextTracks);
      setPresets(nextPresets);
    });
    const interval = setInterval(() => {
      void desktopBridge.listTasks().then(setTasks);
    }, 1_500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (timer.status !== "running" || timer.deadlineMs === null) return;
    const interval = setInterval(() => {
      setTimer((current) => transitionTimer(current, { type: "tick", nowMs: Date.now() }));
    }, 250);
    return () => clearInterval(interval);
  }, [timer.status, timer.deadlineMs]);

  const value = useMemo<LyraState>(() => ({
    tasks,
    tracks,
    draft,
    timer,
    presets,
    preset,
    selectedTaskIds,
    selectedTrackId,
    variationSeed,
    focusSessionId,
    async addTask(title, list, estimate) {
      const task = desktopBridge.available()
        ? await desktopBridge.addTask(title, list, estimate)
        : createTask({ id: crypto.randomUUID(), title, list, estimatedPomodoros: estimate, now: new Date().toISOString() });
      setTasks((current) => [task, ...current]);
    },
    async toggleTask(id) {
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task) return;
      const completed = !task.completed;
      if (desktopBridge.available()) await desktopBridge.setTaskCompleted(id, completed);
      setTasks((current) => current.map((candidate) => candidate.id === id ? { ...candidate, completed } : candidate));
    },
    async moveTask(id, list) {
      if (desktopBridge.available()) await desktopBridge.moveTask(id, list);
      setTasks((current) => current.map((task) => task.id === id ? { ...task, list } : task));
    },
    selectTask(id) {
      setSelectedTaskIds((current) => current.includes(id) ? current.filter((taskId) => taskId !== id) : [...current, id]);
    },
    selectPreset(nextPreset) {
      setPreset(nextPreset);
      setTimer(createTimer(nextPreset));
    },
    async savePreset(nextPreset) {
      const saved = desktopBridge.available()
        ? await desktopBridge.saveTimerPreset(nextPreset)
        : nextPreset;
      setPresets((current) => [
        ...current.filter((candidate) => candidate.id !== saved.id),
        saved
      ]);
    },
    async generateTrack(request) {
      const track = desktopBridge.available()
        ? await desktopBridge.generateTrack(request)
        : generatedFixture(request);
      setDraft(track);
      return track;
    },
    async previewDraft(target) {
      let validated: MusicDraft;
      if (desktopBridge.available()) {
        validated = await desktopBridge.previewDraft(target.id);
      } else {
        await playBrowserPreview(target);
        validated = { ...target, audioValidation: "passed" };
      }
      setDraft(validated);
      return validated;
    },
    async saveDraft() {
      if (!draft) return;
      const track = desktopBridge.available()
        ? await desktopBridge.saveDraft(draft.id)
        : {
            ...draft,
            sourcePath: `${draft.id}.scd`,
            rating: null,
            favorite: false,
            createdAt: new Date().toISOString()
          };
      const { supercolliderSource: _source, audioValidation: _validation, ...saved } = track as typeof track & MusicDraft;
      setTracks((current) => [saved as MusicTrack, ...current]);
      setDraft(null);
    },
    discardDraft() { setDraft(null); },
    async selectTrack(id, variation = false) {
      const seed = variation ? Math.floor(Math.random() * 2_147_483_647) : undefined;
      setSelectedTrackId(id);
      setVariationSeed(seed ?? null);
      if (timer.status === "running" || timer.status === "paused") {
        if (desktopBridge.available()) {
          await desktopBridge.playback(selectionPlaybackAction(id), id, seed);
        } else if (id) {
          const track = tracks.find((candidate) => candidate.id === id);
          if (track) await playBrowserPreview(track);
        } else {
          stopBrowserPreview();
        }
      }
    },
    async previewTrack(id) {
      const track = tracks.find((candidate) => candidate.id === id);
      if (!track) return;
      setSelectedTrackId(id);
      setVariationSeed(null);
      if (desktopBridge.available()) {
        await desktopBridge.playback("play", id);
      } else {
        await playBrowserPreview(track);
      }
    },
    async dispatchTimer(event) {
      let next = transitionTimer(timer, event);
      if (desktopBridge.available()) {
        try { next = await desktopBridge.timerDispatch(event, preset.id); } catch { /* UI remains usable if native runtime is unavailable. */ }
      }
      setTimer(next);
      if (event.type === "start" && !focusSessionId) {
        if (desktopBridge.available()) {
          const session = await desktopBridge.startFocus(selectedTaskIds, preset.id, selectedTrackId);
          setFocusSessionId(session.id);
          if (selectedTrackId) await desktopBridge.playback("play", selectedTrackId, variationSeed ?? undefined);
        } else {
          setFocusSessionId(crypto.randomUUID());
          const track = tracks.find((candidate) => candidate.id === selectedTrackId);
          if (track) await playBrowserPreview(track);
        }
      }
      if (desktopBridge.available()) {
        if (event.type === "pause") await desktopBridge.playback("pause");
        if (event.type === "resume") await desktopBridge.playback("resume");
        if (event.type === "end") await desktopBridge.playback("stop");
      } else {
        if (event.type === "pause" || event.type === "end") stopBrowserPreview();
        if (event.type === "resume") {
          const track = tracks.find((candidate) => candidate.id === selectedTrackId);
          if (track) await playBrowserPreview(track);
        }
      }
    },
    async endFocus(completedTaskIds) {
      if (focusSessionId && desktopBridge.available()) {
        const elapsedSeconds = preset.focusMinutes * 60 - timer.remainingSeconds;
        await desktopBridge.finishFocus(focusSessionId, elapsedSeconds, completedTaskIds);
        await desktopBridge.playback("stop");
      }
      setTasks((current) => current.map((task) => completedTaskIds.includes(task.id) ? { ...task, completed: true } : task));
      setFocusSessionId(null);
      stopBrowserPreview();
      setTimer(timer.status === "awaiting_break" ? timer : createTimer(preset));
    },
    rateTrack(id, rating) {
      const track = tracks.find((candidate) => candidate.id === id);
      if (track && desktopBridge.available()) void desktopBridge.rateTrack(id, rating, track.favorite);
      setTracks((current) => current.map((track) => track.id === id ? { ...track, rating } : track));
    },
    toggleFavorite(id) {
      const track = tracks.find((candidate) => candidate.id === id);
      if (track && desktopBridge.available()) void desktopBridge.rateTrack(id, track.rating, !track.favorite);
      setTracks((current) => current.map((track) => track.id === id ? { ...track, favorite: !track.favorite } : track));
    },
    async saveVariation(id, seed) {
      const parent = tracks.find((track) => track.id === id);
      if (!parent) return;
      const variation = desktopBridge.available()
        ? await desktopBridge.saveVariation(id, seed)
        : {
            ...parent,
            id: crypto.randomUUID(),
            parentTrackId: parent.id,
            title: `${parent.title} — 変化版`,
            canonicalSeed: seed,
            favorite: false,
            rating: null,
            createdAt: new Date().toISOString()
          };
      setTracks((current) => [variation, ...current]);
    }
  }), [tasks, tracks, draft, timer, preset, presets, selectedTaskIds, selectedTrackId, variationSeed, focusSessionId]);

  return <LyraContext.Provider value={value}>{children}</LyraContext.Provider>;
}

export function useLyra(): LyraState {
  const value = useContext(LyraContext);
  if (!value) throw new Error("useLyra must be used inside LyraProvider");
  return value;
}
