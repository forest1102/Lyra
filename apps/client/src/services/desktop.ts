import type { MusicDraft, MusicGenerationRequest, MusicTrack, Task, TaskList, TimerEvent, TimerPreset, TimerState } from "@lyra/domain";

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function selectionPlaybackAction(trackId: string | null): "switch" | "silence" {
  return trackId === null ? "silence" : "switch";
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

export const desktopBridge = {
  available: hasTauri,
  listTasks: () => invoke<Task[]>("list_tasks"),
  addTask: (title: string, list: TaskList, estimatedPomodoros?: number) =>
    invoke<Task>("add_task", { input: { title, list, estimatedPomodoros } }),
  setTaskCompleted: (id: string, completed: boolean) =>
    invoke<void>("set_task_completed", { id, completed }),
  moveTask: (id: string, list: TaskList) => invoke<void>("move_task", { id, list }),
  listTimerPresets: () => invoke<TimerPreset[]>("list_timer_presets"),
  saveTimerPreset: (preset: TimerPreset) => invoke<TimerPreset>("save_timer_preset", { preset }),
  listTracks: () => invoke<MusicTrack[]>("list_music_tracks"),
  generateTrack: (request: MusicGenerationRequest) =>
    invoke<MusicDraft>("generate_music", { request }),
  previewDraft: (draftId: string) => invoke<MusicDraft>("preview_music_draft", { draftId }),
  saveDraft: (draftId: string) => invoke<MusicTrack>("save_music_draft", { draftId }),
  timerDispatch: (event: TimerEvent, presetId: string) => invoke<TimerState>("timer_dispatch", { event, presetId }),
  playback: (action: string, trackId?: string | null, seed?: number) =>
    invoke<void>("music_playback", { action, trackId, seed }),
  startFocus: (taskIds: string[], presetId: string, musicTrackId: string | null) =>
    invoke<{ id: string }>("start_focus", { taskIds, presetId, musicTrackId }),
  finishFocus: (sessionId: string, elapsedSeconds: number, completedTaskIds: string[]) =>
    invoke<void>("finish_focus", { sessionId, elapsedSeconds, completedTaskIds }),
  rateTrack: (id: string, rating: "good" | "poor" | null, favorite: boolean) =>
    invoke<void>("rate_music_track", { id, rating, favorite }),
  saveVariation: (trackId: string, seed: number) =>
    invoke<MusicTrack>("save_variation", { trackId, seed })
};
