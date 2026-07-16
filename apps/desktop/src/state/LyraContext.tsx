import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import {
  BUILTIN_PRESETS,
  DEFAULT_APP_SETTINGS,
  type AddTaskV2,
  type AppSettingsV2,
  type DeleteMusicTracksResult,
  type MusicDraft,
  type MusicGenerationProgress,
  type MusicGenerationRequest,
  type MusicPlaybackState,
  type MusicTrack,
  type MusicTrackListQuery,
  type Project,
  type RuntimeDiagnostic,
  type Tag,
  type Task,
  type TaskList,
  type TaskStatus,
  type TimerEvent,
  type TimerPreset,
  type TimerState,
  type UpdateTask,
} from "../domain";
import { AudioEngine } from "../services/audioEngine";
import type { validateChuckSource } from "../services/audioEngine";
import { desktopBridge, type DesktopBridge } from "../services/desktop";
import { browserRuntimeDiagnostics } from "../services/diagnostics";

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
  subscriptionError: string | null;
  musicError: string | null;
  musicPlayback: MusicPlaybackState;
  retryStartup(): Promise<void>;
  retrySubscriptions(): void;
  tasks: Task[];
  tracks: MusicTrack[];
  libraryTracks: MusicTrack[];
  projects: Project[];
  tags: Tag[];
  settings: AppSettingsV2;
  libraryQuery: MusicTrackListQuery;
  draft: MusicDraft | null;
  timer: TimerState;
  presets: readonly TimerPreset[];
  preset: TimerPreset;
  selectedTaskIds: string[];
  selectedPomodoroTotal: number;
  selectedTrackId: string | null;
  variationSeed: number | null;
  focusSessionId: string | null;
  addTask(title: string, list: TaskList, estimate?: number): Promise<void>;
  addTaskV2(input: AddTaskV2): Promise<Task>;
  updateTask(id: string, input: UpdateTask): Promise<Task>;
  saveProject(project: Project): Promise<Project>;
  saveTag(tag: Tag): Promise<Tag>;
  reorderTasks(ids: string[], status: TaskStatus): Promise<void>;
  toggleTask(id: string): Promise<void>;
  moveTask(id: string, list: TaskList): Promise<void>;
  selectTask(id: string): void;
  selectPreset(preset: TimerPreset): Promise<void>;
  savePreset(preset: TimerPreset): Promise<void>;
  deletePreset(id: string): Promise<void>;
  generateTrack(request: MusicGenerationRequest, onProgress?: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  cancelMusicGeneration(): Promise<void>;
  previewDraft(target: MusicDraft, onProgress?: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  saveDraft(): Promise<void>;
  discardDraft(): Promise<void>;
  stopMusic(): Promise<void>;
  pauseMusic(): Promise<void>;
  resumeMusic(): Promise<void>;
  selectTrack(id: string | null, variation?: boolean): Promise<void>;
  previewTrack(id: string): Promise<void>;
  loadTrackSource(id: string): Promise<string>;
  dispatchTimer(event: TimerEvent): Promise<void>;
  endFocus(completedTaskIds: string[]): Promise<void>;
  rateTrack(id: string, rating: "good" | "poor" | null): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  saveVariation(id: string, seed: number): Promise<void>;
  setLibraryQuery(query: MusicTrackListQuery): Promise<void>;
  renameTrack(id: string, title: string): Promise<MusicTrack>;
  deleteTracks(ids: string[]): Promise<DeleteMusicTracksResult>;
  saveSettings(settings: AppSettingsV2): Promise<AppSettingsV2>;
  runtimeDiagnostics(): Promise<RuntimeDiagnostic[]>;
  openDataDirectory(): Promise<void>;
}

const LyraContext = createContext<LyraState | null>(null);

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function mergePolledTasks(current: Task[], incoming: Task[]): Task[] {
  const currentById = new Map(current.map((task) => [task.id, task]));
  return incoming.map((task) => {
    const local = currentById.get(task.id);
    if (!local) return task;
    return Date.parse(local.updatedAt) > Date.parse(task.updatedAt) ? local : task;
  });
}

export function LyraProvider({
  children,
  bridge = desktopBridge,
  audioEngine = defaultAudioEngine,
  validateSource,
  prepareValidation,
  getBrowserDiagnostics = browserRuntimeDiagnostics,
}: PropsWithChildren<{
  bridge?: DesktopBridge;
  audioEngine?: AudioEngine;
  validateSource?: typeof validateChuckSource;
  prepareValidation?: () => void;
  getBrowserDiagnostics?: () => Promise<RuntimeDiagnostic[]>;
}>) {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [musicPlayback, setMusicPlayback] = useState<MusicPlaybackState>({ status: "stopped", trackId: null, disabled: false });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [libraryTracks, setLibraryTracks] = useState<MusicTrack[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [settings, setSettings] = useState<AppSettingsV2>(DEFAULT_APP_SETTINGS);
  const [libraryQuery, setLibraryQueryState] = useState<MusicTrackListQuery>({ sort: "created_desc" });
  const [draft, setDraft] = useState<MusicDraft | null>(null);
  const [preset, setPreset] = useState<TimerPreset>(BUILTIN_PRESETS[1]);
  const [presets, setPresets] = useState<readonly TimerPreset[]>(BUILTIN_PRESETS);
  const [timer, setTimer] = useState<TimerState>(INITIAL_TIMER);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [variationSeed, setVariationSeed] = useState<number | null>(null);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const [subscriptionAttempt, setSubscriptionAttempt] = useState(0);
  const startupGeneration = useRef(0);
  const taskMutationRevision = useRef(0);
  const pendingTaskMutations = useRef(0);
  const generationRevision = useRef(0);
  const libraryQueryRevision = useRef(0);
  const loadStartup = useCallback(async () => {
    const generation = ++startupGeneration.current;
    setReady(false);
    setStartupError(null);
    try {
      const [nextTasks, nextTracks, nextPresets, nextTimer, nextProjects, nextTags, nextSettings] = await Promise.all([
        bridge.listTasks(),
        bridge.listTracks(),
        bridge.listTimerPresets(),
        bridge.getTimerState(),
        bridge.listProjects(),
        bridge.listTags(),
        bridge.getSettings(),
      ]);
      if (generation !== startupGeneration.current) return;
      setTasks(nextTasks);
      setTracks(nextTracks);
      setLibraryTracks(nextTracks);
      setPresets(nextPresets);
      setProjects(nextProjects);
      setTags(nextTags);
      setSettings(nextSettings);
      audioEngine.setVolume(nextSettings.masterVolume);
      audioEngine.setCrossfadeSeconds(nextSettings.crossfadeSeconds);
      setTimer(nextTimer);
      setPreset(nextTimer.preset);
      setReady(true);
    } catch (error) {
      if (generation !== startupGeneration.current) return;
      setStartupError(message(error));
    }
  }, [audioEngine, bridge]);

  useEffect(() => {
    void loadStartup();
    return () => { startupGeneration.current += 1; };
  }, [loadStartup]);

  const retryStartup = useCallback(async () => {
    await loadStartup();
  }, [loadStartup]);

  const retrySubscriptions = useCallback(() => {
    setSubscriptionAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    setSubscriptionError(null);
    const stopEngine = audioEngine.subscribe((state) => {
      setMusicPlayback(state);
      if (state.disabled) setMusicError("WebChucKが2回停止したため、この集中セッションのBGMを無効にしました");
    });
    let disposed = false;
    let unsubscribe: Array<() => void> = [];
    void Promise.allSettled([
      bridge.subscribeTimerState((nextTimer) => {
        setTimer(nextTimer);
        setPreset(nextTimer.preset);
        const focusActive = nextTimer.phase === "focus"
          && (nextTimer.status === "running" || nextTimer.status === "paused");
        if (!focusActive) {
          setDraft((current) => current?.audioValidation === "deferred_until_focus_ends"
            ? { ...current, audioValidation: "pending" }
            : current);
        }
      }),
      bridge.subscribeAudioStop(() => { void audioEngine.stop(); }),
    ]).then((results) => {
      const next = results.filter((result): result is PromiseFulfilledResult<() => void> => result.status === "fulfilled").map((result) => result.value);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (disposed || failure) next.forEach((stop) => stop());
      if (failure && !disposed) setSubscriptionError(message(failure.reason));
      else if (!disposed) unsubscribe = next;
    });
    return () => { disposed = true; stopEngine(); unsubscribe.forEach((stop) => stop()); };
  }, [audioEngine, bridge, subscriptionAttempt]);

  useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => {
      if (pendingTaskMutations.current > 0) return;
      const revision = taskMutationRevision.current;
      void bridge.listTasks().then((nextTasks) => {
        if (revision !== taskMutationRevision.current) return;
        setTasks((current) => mergePolledTasks(current, nextTasks));
      }).catch(() => undefined);
    }, 1_500);
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

  const selectedPomodoroTotal = useMemo(() => tasks
    .filter((task) => !task.completed && selectedTaskIds.includes(task.id))
    .reduce((total, task) => total + (task.estimatedPomodoros ?? 0), 0), [selectedTaskIds, tasks]);

  const taskMutation = useCallback(async <Value,>(operation: () => Promise<Value>): Promise<Value> => {
    taskMutationRevision.current += 1;
    pendingTaskMutations.current += 1;
    try {
      return await operation();
    } finally {
      pendingTaskMutations.current -= 1;
      taskMutationRevision.current += 1;
    }
  }, []);

  const value = useMemo<LyraState>(() => ({
    ready, startupError, subscriptionError, musicError, musicPlayback, retryStartup, retrySubscriptions, tasks, tracks, libraryTracks, projects, tags, settings, libraryQuery, draft, timer, presets, preset,
    selectedTaskIds, selectedPomodoroTotal, selectedTrackId, variationSeed, focusSessionId,
    async addTask(title, list, estimate) {
      await taskMutation(async () => {
        const task = await bridge.addTask(title, list, estimate);
        setTasks((current) => [task, ...current]);
      });
    },
    async addTaskV2(input) {
      return taskMutation(async () => {
        const task = await bridge.addTaskV2(input);
        setTasks((current) => [task, ...current]);
        return task;
      });
    },
    async updateTask(id, input) {
      return taskMutation(async () => {
        const updated = await bridge.updateTask(id, input);
        setTasks((current) => current.map((task) => task.id === id ? updated : task));
        return updated;
      });
    },
    async saveProject(project) {
      const saved = await bridge.saveProject(project);
      setProjects((current) => [...current.filter((candidate) => candidate.id !== saved.id), saved]
        .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name)));
      return saved;
    },
    async saveTag(tag) {
      const saved = await bridge.saveTag(tag);
      setTags((current) => [...current.filter((candidate) => candidate.id !== saved.id), saved]
        .sort((left, right) => left.name.localeCompare(right.name)));
      return saved;
    },
    async reorderTasks(ids, status) {
      await taskMutation(async () => {
        await bridge.reorderTasks(ids, status);
        const positions = new Map(ids.map((id, position) => [id, position]));
        setTasks((current) => current.map((task) => task.status === status && positions.has(task.id)
          ? { ...task, position: positions.get(task.id)! }
          : task));
      });
    },
    async toggleTask(id) {
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task) return;
      const completed = !task.completed;
      await taskMutation(async () => {
        await bridge.setTaskCompleted(id, completed);
        setTasks((current) => current.map((candidate) => candidate.id === id ? {
          ...candidate,
          completed,
          status: completed ? "completed" : candidate.list === "today" ? "active" : "inbox",
          completedAt: completed ? new Date().toISOString() : null,
        } : candidate));
      });
    },
    async moveTask(id, list) {
      await taskMutation(async () => {
        await bridge.moveTask(id, list);
        setTasks((current) => current.map((task) => task.id === id ? {
          ...task,
          list,
          status: list === "today" ? "active" : "inbox",
          completed: false,
          completedAt: null,
        } : task));
      });
    },
    selectTask(id) { setSelectedTaskIds((current) => current.includes(id) ? current.filter((taskId) => taskId !== id) : [...current, id]); },
    async selectPreset(nextPreset) { await bridge.timerDispatch({ type: "select_preset" }, nextPreset.id); },
    async savePreset(nextPreset) {
      const saved = await bridge.saveTimerPreset(nextPreset);
      setPresets((current) => [...current.filter((candidate) => candidate.id !== saved.id), saved]);
      if (preset.id === saved.id && (timer.status === "idle" || timer.status === "completed")) setPreset(saved);
    },
    async deletePreset(id) { await bridge.deleteTimerPreset(id); setPresets((current) => current.filter((candidate) => candidate.id !== id)); },
    async generateTrack(request, onProgress) {
      const revision = ++generationRevision.current;
      if (draft && musicPlayback.trackId === draft.id) await audioEngine.stop();
      const track = await bridge.generateTrack(request, onProgress);
      if (revision !== generationRevision.current) throw new Error("stale music generation result was discarded");
      setDraft(track);
      return track;
    },
    async cancelMusicGeneration() { generationRevision.current += 1; await bridge.cancelMusicGeneration(); },
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
      setDraft((current) => current?.id === target.id ? validated : current);
      onProgress?.({ phase: "previewing" });
      try {
        await audioEngine.play({ trackId: target.id, source: target.chuckSource, seed: target.canonicalSeed });
      } catch (error) {
        throw new Error(`5秒音声検証は合格しましたが、再生を開始できませんでした。曲は保存できます: ${message(error)}`);
      }
      return validated;
    },
    async saveDraft() { if (!draft) return; if (musicPlayback.trackId === draft.id) await audioEngine.stop(); const track = await bridge.saveDraft(draft.id); libraryQueryRevision.current += 1; setTracks((current) => [track, ...current]); setLibraryTracks((current) => [track, ...current]); setDraft(null); },
    async discardDraft() {
      if (!draft) return;
      if (musicPlayback.trackId === draft.id) await audioEngine.stop();
      await bridge.discardDraft(draft.id);
      setDraft(null);
    },
    async stopMusic() { await audioEngine.stop(); },
    async pauseMusic() { await audioEngine.pause(); },
    async resumeMusic() { await audioEngine.resume(); },
    async selectTrack(id, variation = false) {
      if (id !== null) audioEngine.prepareForUserGesture();
      const seed = variation ? Math.floor(Math.random() * 2_147_483_647) : undefined;
      setSelectedTrackId(id); setVariationSeed(seed ?? null);
      if (id === null) { await audioEngine.stop(); return; }
      if (timer.status === "running" || timer.status === "paused") await playStoredTrack(id, seed);
    },
    async previewTrack(id) {
      audioEngine.prepareForUserGesture();
      await playStoredTrack(id);
    },
    async loadTrackSource(id) { return (await bridge.getTrackSource(id)).chuckSource; },
    async dispatchTimer(event) {
      if (event.type === "start" && (timer.phase !== "focus" || (timer.status !== "idle" && timer.status !== "completed"))) {
        throw new Error(timer.phase !== "focus" || timer.status === "awaiting_break"
          ? "休憩を終了してから次の集中を始めてください"
          : "集中タイマーはすでに動作しています");
      }
      if (event.type === "start" || event.type === "resume") audioEngine.prepareForUserGesture();
      const replaceFinishedSession = event.type === "start" && focusSessionId !== null
        && (timer.phase !== "focus" || timer.status === "completed");
      if (replaceFinishedSession) {
        await bridge.finishFocus(focusSessionId, preset.focusMinutes * 60, []);
        setFocusSessionId(null);
      }
      await bridge.timerDispatch(event, preset.id);
      if (event.type === "start" && (!focusSessionId || replaceFinishedSession)) {
        audioEngine.resetFocusSession();
        const selectedFocusTaskIds = tasks.filter((task) => !task.completed && selectedTaskIds.includes(task.id)).map((task) => task.id);
        let session: { id: string };
        try {
          session = await bridge.startFocus(selectedFocusTaskIds, preset.id, selectedTrackId);
        } catch (startError) {
          try {
            await bridge.timerDispatch({ type: "end", nowMs: Date.now() }, preset.id);
          } catch (compensationError) {
            throw new Error(`${message(startError)}; 開始済みタイマーの停止にも失敗しました: ${message(compensationError)}`);
          }
          throw startError;
        }
        setFocusSessionId(session.id);
        try {
          await audioEngine.stop();
        } catch (error) {
          setMusicError(`BGMを停止できませんでした。集中タイマーは継続しています: ${message(error)}`);
        }
        if (selectedTrackId && settings.playSelectedTrackOnFocus) {
          try {
            setMusicError(null);
            await playStoredTrack(selectedTrackId, variationSeed ?? undefined);
          } catch (error) {
            setMusicError(`BGMを開始できませんでした。集中タイマーは継続しています: ${message(error)}`);
          }
        }
      }
      if (event.type === "pause") await audioEngine.pause();
      if (event.type === "resume") await audioEngine.resume();
      if (event.type === "end") await audioEngine.stop();
    },
    async endFocus(completedTaskIds) {
      if (!focusSessionId) return;
      const elapsedSeconds = timer.phase === "focus" && (timer.status === "running" || timer.status === "paused")
        ? Math.max(0, preset.focusMinutes * 60 - timer.remainingSeconds)
        : preset.focusMinutes * 60;
      await bridge.finishFocus(focusSessionId, elapsedSeconds, completedTaskIds);
      if (timer.phase === "focus" && timer.status !== "awaiting_break") {
        await bridge.timerDispatch({ type: "end", nowMs: Date.now() }, preset.id);
      }
      await audioEngine.stop();
      taskMutationRevision.current += 1;
      setTasks((current) => current.map((task) => completedTaskIds.includes(task.id) ? { ...task, completed: true, status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : task));
      setFocusSessionId(null);
    },
    async rateTrack(id, rating) { const track = tracks.find((candidate) => candidate.id === id); if (!track) return; await bridge.rateTrack(id, rating, track.favorite); libraryQueryRevision.current += 1; const update = (current: MusicTrack[]) => current.map((candidate) => candidate.id === id ? { ...candidate, rating } : candidate); setTracks(update); setLibraryTracks(update); },
    async toggleFavorite(id) { const track = tracks.find((candidate) => candidate.id === id); if (!track) return; await bridge.rateTrack(id, track.rating, !track.favorite); libraryQueryRevision.current += 1; const update = (current: MusicTrack[]) => current.map((candidate) => candidate.id === id ? { ...candidate, favorite: !candidate.favorite } : candidate); setTracks(update); setLibraryTracks(update); },
    async saveVariation(id, seed) { const variation = await bridge.saveVariation(id, seed); libraryQueryRevision.current += 1; setTracks((current) => [variation, ...current]); setLibraryTracks((current) => [variation, ...current]); },
    async setLibraryQuery(query) {
      const revision = ++libraryQueryRevision.current;
      const next = await bridge.listTracks(query);
      if (revision !== libraryQueryRevision.current) return;
      setLibraryQueryState(query);
      setLibraryTracks(next);
    },
    async renameTrack(id, title) {
      const renamed = await bridge.renameTrack(id, title);
      libraryQueryRevision.current += 1;
      setTracks((current) => current.map((track) => track.id === id ? renamed : track));
      setLibraryTracks((current) => current.map((track) => track.id === id ? renamed : track));
      return renamed;
    },
    async deleteTracks(ids) {
      const unique = [...new Set(ids)];
      if (musicPlayback.trackId && unique.includes(musicPlayback.trackId)) await audioEngine.stop();
      const result = await bridge.deleteTracks(unique);
      libraryQueryRevision.current += 1;
      const deleted = new Set(result.deletedIds);
      const unlinked = new Set(result.unlinkedChildIds);
      setTracks((current) => current
        .filter((track) => !deleted.has(track.id))
        .map((track) => unlinked.has(track.id) ? { ...track, parentTrackId: null } : track));
      setLibraryTracks((current) => current
        .filter((track) => !deleted.has(track.id))
        .map((track) => unlinked.has(track.id) ? { ...track, parentTrackId: null } : track));
      if (selectedTrackId && deleted.has(selectedTrackId)) {
        setSelectedTrackId(null);
        setVariationSeed(null);
      }
      return result;
    },
    async saveSettings(nextSettings) {
      const saved = await bridge.saveSettings(nextSettings);
      setSettings(saved);
      audioEngine.setVolume(saved.masterVolume);
      audioEngine.setCrossfadeSeconds(saved.crossfadeSeconds);
      return saved;
    },
    async runtimeDiagnostics() {
      const [native, browser] = await Promise.all([bridge.runtimeDiagnostics(), getBrowserDiagnostics()]);
      return [...native, ...browser];
    },
    async openDataDirectory() { await bridge.openDataDirectory(); },
  }), [
    audioEngine, bridge, draft, focusSessionId,
    getBrowserDiagnostics, libraryQuery, musicError, musicPlayback, playStoredTrack, preset, presets, projects, ready,
    prepareValidation, retryStartup, retrySubscriptions, selectedPomodoroTotal, selectedTaskIds, selectedTrackId,
    libraryTracks, settings, startupError, subscriptionError, tags, taskMutation, tasks, timer, tracks, validateSource, variationSeed,
  ]);

  return <LyraContext.Provider value={value}>{children}</LyraContext.Provider>;
}

export function useLyra(): LyraState {
  const value = useContext(LyraContext);
  if (!value) throw new Error("useLyra must be used inside LyraProvider");
  return value;
}
