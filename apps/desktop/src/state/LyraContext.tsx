import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  BUILTIN_PRESETS,
  type MusicDraft,
  type MusicGenerationProgress,
  type MusicGenerationRequest,
  type MusicPlaybackState,
  type MusicTrack,
  type Task,
  type TaskList,
  type TimerEvent,
  type TimerPreset,
  type TimerState
} from "../domain";
import {
  desktopBridge,
  type DesktopBridge,
  selectionPlaybackAction
} from "../services/desktop";

const INITIAL_TIMER: TimerState = {
  preset: BUILTIN_PRESETS[1],
  phase: "focus",
  status: "idle",
  remainingSeconds: BUILTIN_PRESETS[1].focusMinutes * 60,
  completedFocusCycles: 0,
  deadlineMs: null
};

interface LyraState {
  ready: boolean;
  startupError: string | null;
  musicError: string | null;
  musicPlayback: MusicPlaybackState;
  retryStartup(): Promise<void>;
  tasks: Task[];
  tracks: MusicTrack[];
  draft: MusicDraft | null;
  timer: TimerState;
  presets: readonly TimerPreset[];
  preset: TimerPreset;
  selectedTaskIds: string[];
  selectedTrackId: string | null;
  variationSeed: number | null;
  focusSessionId: string | null;
  addTask(title: string, list: TaskList, estimate?: number): Promise<void>;
  toggleTask(id: string): Promise<void>;
  moveTask(id: string, list: TaskList): Promise<void>;
  selectTask(id: string): void;
  selectPreset(preset: TimerPreset): Promise<void>;
  savePreset(preset: TimerPreset): Promise<void>;
  generateTrack(request: MusicGenerationRequest, onProgress?: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  previewDraft(target: MusicDraft, onProgress?: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  saveDraft(): Promise<void>;
  discardDraft(): void;
  stopMusic(): Promise<void>;
  selectTrack(id: string | null, variation?: boolean): Promise<void>;
  previewTrack(id: string): Promise<void>;
  dispatchTimer(event: TimerEvent): Promise<void>;
  endFocus(completedTaskIds: string[]): Promise<void>;
  rateTrack(id: string, rating: "good" | "poor" | null): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  saveVariation(id: string, seed: number): Promise<void>;
}

const LyraContext = createContext<LyraState | null>(null);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LyraProvider({
  children,
  bridge = desktopBridge
}: PropsWithChildren<{ bridge?: DesktopBridge }>) {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [musicPlayback, setMusicPlayback] = useState<MusicPlaybackState>({ status: "stopped", trackId: null });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [draft, setDraft] = useState<MusicDraft | null>(null);
  const [preset, setPreset] = useState<TimerPreset>(BUILTIN_PRESETS[1]);
  const [presets, setPresets] = useState<readonly TimerPreset[]>(BUILTIN_PRESETS);
  const [timer, setTimer] = useState<TimerState>(INITIAL_TIMER);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [variationSeed, setVariationSeed] = useState<number | null>(null);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const [subscriptionAttempt, setSubscriptionAttempt] = useState(0);

  const loadStartup = useCallback(async () => {
    setReady(false);
    setStartupError(null);
    try {
      const [nextTasks, nextTracks, nextPresets, nextTimer] = await Promise.all([
        bridge.listTasks(),
        bridge.listTracks(),
        bridge.listTimerPresets(),
        bridge.getTimerState()
      ]);
      setTasks(nextTasks);
      setTracks(nextTracks);
      setPresets(nextPresets);
      setTimer(nextTimer);
      setPreset(nextTimer.preset);
      setReady(true);
    } catch (error) {
      setStartupError(message(error));
    }
  }, [bridge]);

  useEffect(() => {
    void loadStartup();
  }, [loadStartup]);

  const retryStartup = useCallback(async () => {
    setSubscriptionAttempt((attempt) => attempt + 1);
    await loadStartup();
  }, [loadStartup]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: Array<() => void> = [];
    void Promise.allSettled([
      bridge.subscribeTimerState((nextTimer) => {
        setTimer(nextTimer);
        setPreset(nextTimer.preset);
      }),
      bridge.subscribeMusicError((error) => {
        setMusicError(error);
      }),
      bridge.subscribeMusicState(setMusicPlayback)
    ]).then((results) => {
      const next = results
        .filter((result): result is PromiseFulfilledResult<() => void> => result.status === "fulfilled")
        .map((result) => result.value);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (disposed || failure) next.forEach((stop) => stop());
      if (failure && !disposed) setStartupError(message(failure.reason));
      else if (!disposed) unsubscribe = next;
    });
    return () => {
      disposed = true;
      unsubscribe.forEach((stop) => stop());
    };
  }, [bridge, subscriptionAttempt]);

  useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => {
      void bridge.listTasks().then(setTasks).catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(interval);
  }, [bridge, ready]);

  const value = useMemo<LyraState>(() => ({
    ready,
    startupError,
    musicError,
    musicPlayback,
    retryStartup,
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
      const task = await bridge.addTask(title, list, estimate);
      setTasks((current) => [task, ...current]);
    },
    async toggleTask(id) {
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task) return;
      const completed = !task.completed;
      await bridge.setTaskCompleted(id, completed);
      setTasks((current) => current.map((candidate) => candidate.id === id ? { ...candidate, completed } : candidate));
    },
    async moveTask(id, list) {
      await bridge.moveTask(id, list);
      setTasks((current) => current.map((task) => task.id === id ? { ...task, list } : task));
    },
    selectTask(id) {
      setSelectedTaskIds((current) => current.includes(id) ? current.filter((taskId) => taskId !== id) : [...current, id]);
    },
    async selectPreset(nextPreset) {
      await bridge.timerDispatch({ type: "select_preset" }, nextPreset.id);
    },
    async savePreset(nextPreset) {
      const saved = await bridge.saveTimerPreset(nextPreset);
      setPresets((current) => [...current.filter((candidate) => candidate.id !== saved.id), saved]);
    },
    async generateTrack(request, onProgress) {
      const track = await bridge.generateTrack(request, onProgress);
      setDraft(track);
      return track;
    },
    async previewDraft(target, onProgress) {
      const validated = await bridge.previewDraft(target.id, onProgress);
      setDraft(validated);
      return validated;
    },
    async saveDraft() {
      if (!draft) return;
      const track = await bridge.saveDraft(draft.id);
      setTracks((current) => [track, ...current]);
      setDraft(null);
    },
    discardDraft() {
      setDraft(null);
    },
    async stopMusic() {
      await bridge.playback("stop");
      setSelectedTrackId(null);
      setVariationSeed(null);
    },
    async selectTrack(id, variation = false) {
      const seed = variation ? Math.floor(Math.random() * 2_147_483_647) : undefined;
      setSelectedTrackId(id);
      setVariationSeed(seed ?? null);
      if (timer.status === "running" || timer.status === "paused") {
        await bridge.playback(selectionPlaybackAction(id), id, seed);
      }
    },
    async previewTrack(id) {
      setSelectedTrackId(id);
      setVariationSeed(null);
      await bridge.playback("play", id);
    },
    async dispatchTimer(event) {
      await bridge.timerDispatch(event, preset.id);
      if (event.type === "start" && !focusSessionId) {
        const session = await bridge.startFocus(selectedTaskIds, preset.id, selectedTrackId);
        setFocusSessionId(session.id);
        if (selectedTrackId) {
          await bridge.playback("play", selectedTrackId, variationSeed ?? undefined);
        }
      }
      if (event.type === "pause") {
        await bridge.playback("pause");
      }
      if (event.type === "resume") {
        await bridge.playback("resume");
      }
      if (event.type === "end") {
        await bridge.playback("stop");
      }
    },
    async endFocus(completedTaskIds) {
      if (!focusSessionId) return;
      const elapsedSeconds = preset.focusMinutes * 60 - timer.remainingSeconds;
      await bridge.finishFocus(focusSessionId, elapsedSeconds, completedTaskIds);
      if (timer.status !== "awaiting_break") {
        await bridge.timerDispatch({ type: "end", nowMs: Date.now() }, preset.id);
      }
      await bridge.playback("stop");
      setTasks((current) => current.map((task) => completedTaskIds.includes(task.id) ? { ...task, completed: true } : task));
      setFocusSessionId(null);
    },
    async rateTrack(id, rating) {
      const track = tracks.find((candidate) => candidate.id === id);
      if (!track) return;
      await bridge.rateTrack(id, rating, track.favorite);
      setTracks((current) => current.map((candidate) => candidate.id === id ? { ...candidate, rating } : candidate));
    },
    async toggleFavorite(id) {
      const track = tracks.find((candidate) => candidate.id === id);
      if (!track) return;
      await bridge.rateTrack(id, track.rating, !track.favorite);
      setTracks((current) => current.map((candidate) => candidate.id === id ? { ...candidate, favorite: !candidate.favorite } : candidate));
    },
    async saveVariation(id, seed) {
      const variation = await bridge.saveVariation(id, seed);
      setTracks((current) => [variation, ...current]);
    }
  }), [
    bridge,
    draft,
    focusSessionId,
    loadStartup,
    musicError,
    musicPlayback,
    preset,
    presets,
    ready,
    retryStartup,
    selectedTaskIds,
    selectedTrackId,
    startupError,
    tasks,
    timer,
    tracks,
    variationSeed
  ]);

  return <LyraContext.Provider value={value}>{children}</LyraContext.Provider>;
}

export function useLyra(): LyraState {
  const value = useContext(LyraContext);
  if (!value) throw new Error("useLyra must be used inside LyraProvider");
  return value;
}
