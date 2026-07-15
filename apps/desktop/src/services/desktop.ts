import { Channel, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  MusicDraft,
  MusicGenerationProgress,
  MusicGenerationRequest,
  MusicPlaybackState,
  MusicTrack,
  Task,
  TaskList,
  TimerEvent,
  TimerPreset,
  TimerState
} from "../domain";
import { EventRequestBroker, type IpcResult } from "./eventRequest";

export function selectionPlaybackAction(trackId: string | null): "switch" | "silence" {
  return trackId === null ? "silence" : "switch";
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (import.meta.env.VITE_E2E === "1") {
    const e2eWindow = window as unknown as {
      __wdio_mocks__?: Record<string, (input?: Record<string, unknown>) => Promise<T>>;
      __TAURI__?: { core?: { invoke: <Value>(name: string, input?: Record<string, unknown>) => Promise<Value> } };
    };
    const mock = e2eWindow.__wdio_mocks__?.[command];
    if (mock) return mock(args);
    const globalTauri = e2eWindow.__TAURI__;
    if (globalTauri?.core?.invoke) return globalTauri.core.invoke<T>(command, args);
  }
  return tauriInvoke<T>(command, args);
}

const eventRequests = new EventRequestBroker({
  emit,
  listen: (event, listener) => listen<IpcResult>(event, listener)
});

export interface DesktopBridge {
  listTasks(): Promise<Task[]>;
  addTask(title: string, list: TaskList, estimatedPomodoros?: number): Promise<Task>;
  setTaskCompleted(id: string, completed: boolean): Promise<void>;
  moveTask(id: string, list: TaskList): Promise<void>;
  listTimerPresets(): Promise<TimerPreset[]>;
  saveTimerPreset(preset: TimerPreset): Promise<TimerPreset>;
  getTimerState(): Promise<TimerState>;
  listTracks(): Promise<MusicTrack[]>;
  generateTrack(request: MusicGenerationRequest, onProgress?: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  previewDraft(draftId: string, onProgress?: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  saveDraft(draftId: string): Promise<MusicTrack>;
  timerDispatch(event: TimerEvent, presetId: string): Promise<TimerState>;
  playback(action: string, trackId?: string | null, seed?: number): Promise<void>;
  startFocus(taskIds: string[], presetId: string, musicTrackId: string | null): Promise<{ id: string }>;
  finishFocus(sessionId: string, elapsedSeconds: number, completedTaskIds: string[]): Promise<void>;
  rateTrack(id: string, rating: "good" | "poor" | null, favorite: boolean): Promise<void>;
  saveVariation(trackId: string, seed: number): Promise<MusicTrack>;
  subscribeTimerState(listener: (state: TimerState) => void): Promise<UnlistenFn>;
  subscribeMusicError(listener: (message: string) => void): Promise<UnlistenFn>;
  subscribeMusicState(listener: (state: MusicPlaybackState) => void): Promise<UnlistenFn>;
}

export const desktopBridge: DesktopBridge = {
  listTasks: () => invoke<Task[]>("list_tasks"),
  addTask: (title, list, estimatedPomodoros) => invoke<Task>("add_task", { input: { title, list, estimatedPomodoros } }),
  setTaskCompleted: (id, completed) => invoke<void>("set_task_completed", { id, completed }),
  moveTask: (id, list) => invoke<void>("move_task", { id, list }),
  listTimerPresets: () => invoke<TimerPreset[]>("list_timer_presets"),
  saveTimerPreset: (preset) => invoke<TimerPreset>("save_timer_preset", { preset }),
  getTimerState: () => invoke<TimerState>("get_timer_state"),
  listTracks: () => invoke<MusicTrack[]>("list_music_tracks"),
  generateTrack: (request, onProgress) => {
    const progress = new Channel<MusicGenerationProgress>();
    progress.onmessage = onProgress ?? (() => undefined);
    return invoke<MusicDraft>("generate_music", { request, onProgress: progress });
  },
  previewDraft: (draftId, onProgress) => {
    const progress = new Channel<MusicGenerationProgress>();
    progress.onmessage = onProgress ?? (() => undefined);
    return invoke<MusicDraft>("preview_music_draft", { draftId, onProgress: progress });
  },
  saveDraft: (draftId) => invoke<MusicTrack>("save_music_draft", { draftId }),
  timerDispatch: (event, presetId) => eventRequests.request<TimerState>("timer://control", { event, presetId }),
  playback: (action, trackId, seed) => eventRequests.request<void>("music://control", { action, trackId, seed }),
  startFocus: (taskIds, presetId, musicTrackId) => invoke<{ id: string }>("start_focus", { taskIds, presetId, musicTrackId }),
  finishFocus: (sessionId, elapsedSeconds, completedTaskIds) => invoke<void>("finish_focus", { sessionId, elapsedSeconds, completedTaskIds }),
  rateTrack: (id, rating, favorite) => invoke<void>("rate_music_track", { id, rating, favorite }),
  saveVariation: (trackId, seed) => invoke<MusicTrack>("save_variation", { trackId, seed }),
  subscribeTimerState: (listener) => listen<TimerState>("timer://state", (event) => listener(event.payload)),
  subscribeMusicError: (listener) => listen<string>("music://error", (event) => listener(event.payload)),
  subscribeMusicState: (listener) => listen<MusicPlaybackState>("music://state", (event) => listener(event.payload))
};
