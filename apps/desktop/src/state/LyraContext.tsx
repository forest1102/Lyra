import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
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
  type TimerState,
} from "../domain";
import { AudioEngine } from "../services/audioEngine";
import type { validateChuckSource } from "../services/audioEngine";
import { desktopBridge, type DesktopBridge } from "../services/desktop";

const INITIAL_TIMER: TimerState = {
  preset: BUILTIN_PRESETS[1],
  phase: "focus",
  status: "idle",
  remainingSeconds: BUILTIN_PRESETS[1].focusMinutes * 60,
  completedFocusCycles: 0,
  deadlineMs: null,
};

const defaultAudioEngine = new AudioEngine();

export interface LyraState {
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
  cancelMusicGeneration(): Promise<void>;
  previewDraft(target: MusicDraft, onProgress?: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  saveDraft(): Promise<void>;
  discardDraft(): void;
  stopMusic(): Promise<void>;
  selectTrack(id: string | null, variation?: boolean): Promise<void>;
  previewTrack(id: string): Promise<void>;
  loadTrackSource(id: string): Promise<string>;
  dispatchTimer(event: TimerEvent): Promise<void>;
  endFocus(completedTaskIds: string[]): Promise<void>;
  rateTrack(id: string, rating: "good" | "poor" | null): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  saveVariation(id: string, seed: number): Promise<void>;
}

const LyraContext = createContext<LyraState | null>(null);

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function LyraProvider({
  children,
  bridge = desktopBridge,
  audioEngine = defaultAudioEngine,
  validateSource,
  prepareValidation,
}: PropsWithChildren<{
  bridge?: DesktopBridge;
  audioEngine?: AudioEngine;
  validateSource?: typeof validateChuckSource;
  prepareValidation?: () => void;
}>) {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [musicPlayback, setMusicPlayback] = useState<MusicPlaybackState>({ status: "stopped", trackId: null, disabled: false });
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
        bridge.getTimerState(),
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
  }, [audioEngine, bridge]);

  useEffect(() => { void loadStartup(); }, [loadStartup]);

  const retryStartup = useCallback(async () => {
    setSubscriptionAttempt((attempt) => attempt + 1);
    await loadStartup();
  }, [loadStartup]);

  useEffect(() => {
    const stopEngine = audioEngine.subscribe((state) => {
      setMusicPlayback(state);
      if (state.disabled) setMusicError("WebChucKが2回停止したため、この集中セッションのBGMを無効にしました");
    });
    let disposed = false;
    let unsubscribe: Array<() => void> = [];
    void Promise.allSettled([
      bridge.subscribeTimerState((nextTimer) => { setTimer(nextTimer); setPreset(nextTimer.preset); }),
      bridge.subscribeAudioStop(() => { void audioEngine.stop(); }),
    ]).then((results) => {
      const next = results.filter((result): result is PromiseFulfilledResult<() => void> => result.status === "fulfilled").map((result) => result.value);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (disposed || failure) next.forEach((stop) => stop());
      if (failure && !disposed) setStartupError(message(failure.reason));
      else if (!disposed) unsubscribe = next;
    });
    return () => { disposed = true; stopEngine(); unsubscribe.forEach((stop) => stop()); };
  }, [audioEngine, bridge, subscriptionAttempt]);

  useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => { void bridge.listTasks().then(setTasks).catch(() => undefined); }, 1_500);
    return () => window.clearInterval(interval);
  }, [bridge, ready]);

  const playStoredTrack = useCallback(async (id: string, seed?: number) => {
    const [track, source] = await Promise.all([
      Promise.resolve(tracks.find((candidate) => candidate.id === id)),
      bridge.getTrackSource(id),
    ]);
    if (!track) throw new Error("track was not found");
    await audioEngine.play({ trackId: id, source: source.chuckSource, seed: seed ?? track.canonicalSeed });
  }, [audioEngine, bridge, tracks]);

  const value = useMemo<LyraState>(() => ({
    ready, startupError, musicError, musicPlayback, retryStartup, tasks, tracks, draft, timer, presets, preset,
    selectedTaskIds, selectedTrackId, variationSeed, focusSessionId,
    async addTask(title, list, estimate) { const task = await bridge.addTask(title, list, estimate); setTasks((current) => [task, ...current]); },
    async toggleTask(id) { const task = tasks.find((candidate) => candidate.id === id); if (!task) return; const completed = !task.completed; await bridge.setTaskCompleted(id, completed); setTasks((current) => current.map((candidate) => candidate.id === id ? { ...candidate, completed } : candidate)); },
    async moveTask(id, list) { await bridge.moveTask(id, list); setTasks((current) => current.map((task) => task.id === id ? { ...task, list } : task)); },
    selectTask(id) { setSelectedTaskIds((current) => current.includes(id) ? current.filter((taskId) => taskId !== id) : [...current, id]); },
    async selectPreset(nextPreset) { await bridge.timerDispatch({ type: "select_preset" }, nextPreset.id); },
    async savePreset(nextPreset) { const saved = await bridge.saveTimerPreset(nextPreset); setPresets((current) => [...current.filter((candidate) => candidate.id !== saved.id), saved]); },
    async generateTrack(request, onProgress) {
      const track = await bridge.generateTrack(request, onProgress);
      setDraft(track);
      return track;
    },
    async cancelMusicGeneration() { await bridge.cancelMusicGeneration(); },
    async previewDraft(target, onProgress) {
      audioEngine.prepareForUserGesture();
      prepareValidation?.();
      if (target.audioValidation === "deferred_until_focus_ends") throw new Error("audio validation is deferred until focus ends");
      setMusicError(null);
      onProgress?.({ phase: "validating" });
      const report = await (validateSource
        ? validateSource(target.chuckSource, target.canonicalSeed)
        : audioEngine.validateSource(target.chuckSource, target.canonicalSeed));
      const validated = await bridge.confirmDraftValidation(target.id, report);
      setDraft(validated);
      onProgress?.({ phase: "previewing" });
      await audioEngine.play({ trackId: target.id, source: target.chuckSource, seed: target.canonicalSeed });
      return validated;
    },
    async saveDraft() { if (!draft) return; const track = await bridge.saveDraft(draft.id); setTracks((current) => [track, ...current]); setDraft(null); },
    discardDraft() { setDraft(null); },
    async stopMusic() { await audioEngine.stop(); setSelectedTrackId(null); setVariationSeed(null); },
    async selectTrack(id, variation = false) {
      if (id !== null) audioEngine.prepareForUserGesture();
      const seed = variation ? Math.floor(Math.random() * 2_147_483_647) : undefined;
      setSelectedTrackId(id); setVariationSeed(seed ?? null);
      if (id === null) { await audioEngine.stop(); return; }
      if (timer.status === "running" || timer.status === "paused") await playStoredTrack(id, seed);
    },
    async previewTrack(id) {
      audioEngine.prepareForUserGesture();
      setSelectedTrackId(id);
      setVariationSeed(null);
      await playStoredTrack(id);
    },
    async loadTrackSource(id) { return (await bridge.getTrackSource(id)).chuckSource; },
    async dispatchTimer(event) {
      if (event.type === "start" || event.type === "resume") audioEngine.prepareForUserGesture();
      await bridge.timerDispatch(event, preset.id);
      if (event.type === "start" && !focusSessionId) {
        audioEngine.resetFocusSession();
        const session = await bridge.startFocus(selectedTaskIds, preset.id, selectedTrackId);
        setFocusSessionId(session.id);
        if (selectedTrackId) await playStoredTrack(selectedTrackId, variationSeed ?? undefined);
      }
      if (event.type === "pause") await audioEngine.pause();
      if (event.type === "resume") await audioEngine.resume();
      if (event.type === "end") await audioEngine.stop();
    },
    async endFocus(completedTaskIds) {
      if (!focusSessionId) return;
      const elapsedSeconds = preset.focusMinutes * 60 - timer.remainingSeconds;
      await bridge.finishFocus(focusSessionId, elapsedSeconds, completedTaskIds);
      if (timer.status !== "awaiting_break") await bridge.timerDispatch({ type: "end", nowMs: Date.now() }, preset.id);
      await audioEngine.stop();
      setTasks((current) => current.map((task) => completedTaskIds.includes(task.id) ? { ...task, completed: true } : task));
      setFocusSessionId(null);
    },
    async rateTrack(id, rating) { const track = tracks.find((candidate) => candidate.id === id); if (!track) return; await bridge.rateTrack(id, rating, track.favorite); setTracks((current) => current.map((candidate) => candidate.id === id ? { ...candidate, rating } : candidate)); },
    async toggleFavorite(id) { const track = tracks.find((candidate) => candidate.id === id); if (!track) return; await bridge.rateTrack(id, track.rating, !track.favorite); setTracks((current) => current.map((candidate) => candidate.id === id ? { ...candidate, favorite: !candidate.favorite } : candidate)); },
    async saveVariation(id, seed) { const variation = await bridge.saveVariation(id, seed); setTracks((current) => [variation, ...current]); },
  }), [
    audioEngine, bridge, draft, focusSessionId,
    musicError, musicPlayback, playStoredTrack, preset, presets, ready,
    prepareValidation, retryStartup, selectedTaskIds, selectedTrackId,
    startupError, tasks, timer, tracks, validateSource, variationSeed,
  ]);

  return <LyraContext.Provider value={value}>{children}</LyraContext.Provider>;
}

export function useLyra(): LyraState {
  const value = useContext(LyraContext);
  if (!value) throw new Error("useLyra must be used inside LyraProvider");
  return value;
}
