import { Channel, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AddTaskV2,
  AppSettingsV1,
  DeleteMusicTracksResult,
  DraftValidationReport,
  MusicDraft,
  MusicGenerationProgress,
  MusicGenerationRequest,
  MusicTrack,
  MusicTrackListQuery,
  MusicTrackSource,
  Project,
  RuntimeDiagnostic,
  Tag,
  Task,
  TaskList,
  TaskStatus,
  TimerEvent,
  TimerPreset,
  TimerState,
  UpdateTask
} from "../domain";
import { EventRequestBroker, type IpcResult } from "./eventRequest";

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
  addTaskV2(input: AddTaskV2): Promise<Task>;
  updateTask(id: string, input: UpdateTask): Promise<Task>;
  reorderTasks(ids: string[], status: TaskStatus): Promise<void>;
  listProjects(): Promise<Project[]>;
  saveProject(project: Project): Promise<Project>;
  listTags(): Promise<Tag[]>;
  saveTag(tag: Tag): Promise<Tag>;
  setTaskCompleted(id: string, completed: boolean): Promise<void>;
  moveTask(id: string, list: TaskList): Promise<void>;
  listTimerPresets(): Promise<TimerPreset[]>;
  saveTimerPreset(preset: TimerPreset): Promise<TimerPreset>;
  deleteTimerPreset(id: string): Promise<void>;
  getTimerState(): Promise<TimerState>;
  listTracks(query?: MusicTrackListQuery): Promise<MusicTrack[]>;
  renameTrack(id: string, title: string): Promise<MusicTrack>;
  deleteTracks(ids: string[]): Promise<DeleteMusicTracksResult>;
  getSettings(): Promise<AppSettingsV1>;
  saveSettings(settings: AppSettingsV1): Promise<AppSettingsV1>;
  runtimeDiagnostics(): Promise<RuntimeDiagnostic[]>;
  openDataDirectory(): Promise<void>;
  generateTrack(request: MusicGenerationRequest, onProgress?: (progress: MusicGenerationProgress) => void): Promise<MusicDraft>;
  cancelMusicGeneration(): Promise<void>;
  confirmDraftValidation(draftId: string, report: DraftValidationReport): Promise<MusicDraft>;
  discardDraft(draftId: string): Promise<void>;
  saveDraft(draftId: string): Promise<MusicTrack>;
  getTrackSource(trackId: string): Promise<MusicTrackSource>;
  timerDispatch(event: TimerEvent, presetId: string): Promise<TimerState>;
  startFocus(taskIds: string[], presetId: string, musicTrackId: string | null): Promise<{ id: string }>;
  finishFocus(sessionId: string, elapsedSeconds: number, completedTaskIds: string[]): Promise<void>;
  rateTrack(id: string, rating: "good" | "poor" | null, favorite: boolean): Promise<void>;
  saveVariation(trackId: string, seed: number): Promise<MusicTrack>;
  subscribeTimerState(listener: (state: TimerState) => void): Promise<UnlistenFn>;
  subscribeAudioStop(listener: () => void): Promise<UnlistenFn>;
}

export const desktopBridge: DesktopBridge = {
  listTasks: () => invoke<Task[]>("list_tasks"),
  addTask: (title, list, estimatedPomodoros) => invoke<Task>("add_task", { input: { title, list, estimatedPomodoros } }),
  addTaskV2: (input) => invoke<Task>("add_task_v2", { input }),
  updateTask: (id, input) => invoke<Task>("update_task", { id, input }),
  reorderTasks: (ids, status) => invoke<void>("reorder_tasks", { ids, status }),
  listProjects: () => invoke<Project[]>("list_projects"),
  saveProject: (project) => invoke<Project>("save_project", { project }),
  listTags: () => invoke<Tag[]>("list_tags"),
  saveTag: (tag) => invoke<Tag>("save_tag", { tag }),
  setTaskCompleted: (id, completed) => invoke<void>("set_task_completed", { id, completed }),
  moveTask: (id, list) => invoke<void>("move_task", { id, list }),
  listTimerPresets: () => invoke<TimerPreset[]>("list_timer_presets"),
  saveTimerPreset: (preset) => invoke<TimerPreset>("save_timer_preset", { preset }),
  deleteTimerPreset: (id) => invoke<void>("delete_timer_preset", { id }),
  getTimerState: () => invoke<TimerState>("get_timer_state"),
  listTracks: (query) => invoke<MusicTrack[]>("list_music_tracks", query === undefined ? undefined : { query }),
  renameTrack: (id, title) => invoke<MusicTrack>("rename_music_track", { id, title }),
  deleteTracks: (ids) => invoke<DeleteMusicTracksResult>("delete_music_tracks", { ids }),
  getSettings: () => invoke<AppSettingsV1>("get_app_settings"),
  saveSettings: (settings) => invoke<AppSettingsV1>("save_app_settings", { settings }),
  runtimeDiagnostics: () => invoke<RuntimeDiagnostic[]>("runtime_diagnostics"),
  openDataDirectory: () => invoke<void>("open_data_directory"),
  generateTrack: (request, onProgress) => {
    const progress = new Channel<MusicGenerationProgress>();
    progress.onmessage = onProgress ?? (() => undefined);
    const input = "version" in request ? { recipe: request } : request;
    return invoke<MusicDraft>("generate_music", { request: input, onProgress: progress });
  },
  cancelMusicGeneration: () => invoke<void>("cancel_music_generation"),
  confirmDraftValidation: (draftId, report) => invoke<MusicDraft>("confirm_music_draft_validation", { draftId, report }),
  discardDraft: (draftId) => invoke<void>("discard_music_draft", { draftId }),
  saveDraft: (draftId) => invoke<MusicTrack>("save_music_draft", { draftId }),
  getTrackSource: (trackId) => invoke<MusicTrackSource>("get_music_track_source", { trackId }),
  timerDispatch: (event, presetId) => eventRequests.request<TimerState>("timer://control", { event, presetId }),
  startFocus: (taskIds, presetId, musicTrackId) => invoke<{ id: string }>("start_focus", { taskIds, presetId, musicTrackId }),
  finishFocus: (sessionId, elapsedSeconds, completedTaskIds) => invoke<void>("finish_focus", { sessionId, elapsedSeconds, completedTaskIds }),
  rateTrack: (id, rating, favorite) => invoke<void>("rate_music_track", { id, rating, favorite }),
  saveVariation: (trackId, seed) => invoke<MusicTrack>("save_variation", { trackId, seed }),
  subscribeTimerState: (listener) => listen<TimerState>("timer://state", (event) => listener(event.payload)),
  subscribeAudioStop: (listener) => listen("audio://stop", () => listener())
};
