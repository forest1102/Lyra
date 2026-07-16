import {
  DEFAULT_APP_SETTINGS,
  BUILTIN_PRESETS,
  type AddTaskV2,
  type AppSettingsV2,
  type DraftValidationReport,
  type MusicDraft,
  type MusicGenerationRequest,
  type LegacyMusicGenerationRequest,
  type MusicRecipeV1,
  type MusicTrack,
  type MusicTrackListQuery,
  type Project,
  type RuntimeDiagnostic,
  type Tag,
  type Task,
  type TaskList,
  type TimerEvent,
  type TimerPreset,
  type TimerState,
  type UpdateTask,
} from "../domain";
import type { DesktopBridge } from "./desktop";

const SAFE_CHUCK_SOURCE = `Math.srandom(__LYRA_SEED__);
SinOsc tone => Gain master => dac;
0.035 => master.gain;
220 => tone.freq;
while (true) {
  4::second => now;
}`;

const SAFE_CHUCK_SHA256 = "2a6d9a1239d1c8ddf921e3a713fa233c39670988bcbee24d7566146050ebc15e";

const initialTrack: MusicTrack = {
  id: "browser-track-1",
  parentTrackId: null,
  title: "静かなブラウザ・ドリフト",
  description: "ブラウザ開発用の安全な固定ChucKトラック",
  theme: "organic-drift",
  arrangement: "ambient",
  brightness: "low",
  density: "low",
  motion: "low",
  bpm: 60,
  tailSeconds: 2,
  sourcePath: "browser-dev://safe-drift.ck",
  sourceSha256: SAFE_CHUCK_SHA256,
  canonicalSeed: 42,
  rating: null,
  favorite: false,
  recipeVersion: null,
  recipeJson: null,
  structureFamily: "ambient",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function taskDefaults(status: Task["status"]): Pick<Task,
  "status" | "priority" | "projectId" | "parentId" | "notes" | "plannedDate" | "dueDate" | "position" | "completedAt" | "recurrence" | "tags"
> {
  return {
    status,
    priority: "none",
    projectId: null,
    parentId: null,
    notes: "",
    plannedDate: null,
    dueDate: null,
    position: 0,
    completedAt: null,
    recurrence: null,
    tags: [],
  };
}

const initialTasks: Task[] = [
  {
    id: "browser-task-1",
    title: "Lyraの画面を確認する",
    list: "today",
    completed: false,
    estimatedPomodoros: 1,
    ...taskDefaults("active"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "browser-task-2",
    title: "次の集中セッションを計画する",
    list: "backlog",
    completed: false,
    estimatedPomodoros: 2,
    ...taskDefaults("inbox"),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function cloneTimer(state: TimerState): TimerState {
  return { ...state, preset: { ...state.preset } };
}

function cloneTask(task: Task): Task {
  return { ...task, tags: task.tags.map((tag) => ({ ...tag })) };
}

export function createBrowserDevBridge(): DesktopBridge {
  let sequence = 1;
  let tasks = initialTasks.map((task) => ({ ...task }));
  let tracks = [{ ...initialTrack }];
  let presets = BUILTIN_PRESETS.map((preset) => ({ ...preset }));
  let projects: Project[] = [
    { id: "browser-project-1", name: "Lyra", color: "#d8f068", position: 0 },
  ];
  let tags: Tag[] = [{ id: "browser-tag-1", name: "設計" }];
  let settings: AppSettingsV2 = { ...DEFAULT_APP_SETTINGS };
  let timer: TimerState = {
    preset: presets.find((preset) => preset.id === "standard") ?? presets[0],
    phase: "focus",
    status: "idle",
    remainingSeconds: 25 * 60,
    completedFocusCycles: 0,
    deadlineMs: null,
  };
  const drafts = new Map<string, MusicDraft>();
  const timerListeners = new Set<(state: TimerState) => void>();
  const audioStopListeners = new Set<() => void>();
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let generationEpoch = 0;

  const now = () => new Date().toISOString();
  const nextId = (prefix: string) => `${prefix}-${++sequence}`;
  const nextRecurringDate = (value: string | null, recurrence: Task["recurrence"]): string | null => {
    if (!value || !recurrence) return value;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (recurrence === "daily") date.setUTCDate(date.getUTCDate() + 1);
    if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
    if (recurrence === "monthly") {
      const targetMonth = month;
      const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
      date.setUTCFullYear(year, targetMonth, Math.min(day, lastDay));
    }
    return date.toISOString().slice(0, 10);
  };
  const addDays = (value: string, days: number): string => {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const appendNextOccurrence = (completedTask: Task) => {
    if (!completedTask.recurrence) return;
    const timestamp = now();
    const nextPlannedDate = nextRecurringDate(completedTask.plannedDate, completedTask.recurrence);
    const dueOffsetDays = completedTask.plannedDate && completedTask.dueDate
      ? Math.round((Date.parse(`${completedTask.dueDate}T00:00:00.000Z`) - Date.parse(`${completedTask.plannedDate}T00:00:00.000Z`)) / 86_400_000)
      : null;
    tasks = [...tasks, {
      ...completedTask,
      id: nextId("browser-task"),
      list: "today",
      completed: false,
      status: "active",
      plannedDate: nextPlannedDate,
      dueDate: nextPlannedDate && dueOffsetDays !== null
        ? addDays(nextPlannedDate, dueOffsetDays)
        : nextRecurringDate(completedTask.dueDate, completedTask.recurrence),
      completedAt: null,
      tags: completedTask.tags.map((tag) => ({ ...tag })),
      createdAt: timestamp,
      updatedAt: timestamp,
    }];
  };
  const publishTimer = () => {
    const snapshot = cloneTimer(timer);
    timerListeners.forEach((listener) => listener(snapshot));
  };
  const stopTimerScheduler = () => {
    if (timerInterval === null) return;
    clearInterval(timerInterval);
    timerInterval = null;
  };
  const tickTimer = (nowMs: number) => {
    if (timer.status !== "running" || timer.deadlineMs === null) return;
    const remainingSeconds = Math.max(0, Math.ceil((timer.deadlineMs - nowMs) / 1_000));
    timer = { ...timer, remainingSeconds };
    if (remainingSeconds > 0) return;

    if (timer.phase === "focus") {
      const completedFocusCycles = timer.completedFocusCycles + 1;
      audioStopListeners.forEach((listener) => listener());
      timer = {
        ...timer,
        status: "awaiting_break",
        completedFocusCycles,
        deadlineMs: null,
      };
      if (settings.autoStartBreak) {
        const longBreak = completedFocusCycles % timer.preset.cyclesBeforeLongBreak === 0;
        const phase = longBreak ? "long_break" : "short_break";
        const breakMinutes = longBreak ? timer.preset.longBreakMinutes : timer.preset.shortBreakMinutes;
        timer = { ...timer, phase, status: "running", remainingSeconds: breakMinutes * 60, deadlineMs: nowMs + breakMinutes * 60_000 };
      }
    } else {
      timer = {
        ...timer,
        phase: "focus",
        status: "completed",
        remainingSeconds: timer.preset.focusMinutes * 60,
        deadlineMs: null,
      };
    }
  };
  const reconcileTimerScheduler = () => {
    if (timer.status !== "running" || timerListeners.size === 0) {
      stopTimerScheduler();
      return;
    }
    if (timerInterval !== null) return;
    timerInterval = setInterval(() => {
      tickTimer(Date.now());
      publishTimer();
      reconcileTimerScheduler();
    }, 250);
  };

  return {
    async listTasks() { return tasks.map(cloneTask); },
    async addTask(title: string, list: TaskList, estimatedPomodoros?: number) {
      const timestamp = now();
      const task: Task = {
        id: nextId("browser-task"),
        title,
        list,
        completed: false,
        estimatedPomodoros: estimatedPomodoros ?? null,
        ...taskDefaults(list === "today" ? "active" : "inbox"),
        position: tasks.filter((candidate) => candidate.list === list).length,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tasks = [task, ...tasks];
      return { ...task };
    },
    async addTaskV2(input: AddTaskV2) {
      const timestamp = now();
      const status = input.status ?? "inbox";
      const title = input.title.trim();
      if (!title) throw new Error("task title must not be empty");
      if (status === "completed" && input.recurrence) throw new Error("completed tasks cannot be created with recurrence");
      if (input.parentId && input.recurrence) throw new Error("recurring tasks cannot be subtasks");
      const parent = input.parentId ? tasks.find((task) => task.id === input.parentId) : null;
      if (input.parentId && !parent) throw new Error("parent task was not found");
      if (parent?.parentId) throw new Error("subtasks support one level only");
      if (parent?.recurrence) throw new Error("recurring tasks cannot have subtasks");
      const task: Task = {
        id: nextId("browser-task"),
        title,
        list: status === "active" ? "today" : "backlog",
        completed: status === "completed",
        estimatedPomodoros: input.estimatedPomodoros ?? null,
        ...taskDefaults(status),
        priority: input.priority ?? "none",
        projectId: input.projectId ?? null,
        parentId: input.parentId ?? null,
        notes: input.notes ?? "",
        plannedDate: input.plannedDate ?? null,
        dueDate: input.dueDate ?? null,
        position: tasks.filter((candidate) => candidate.status === status).length,
        completedAt: status === "completed" ? timestamp : null,
        recurrence: input.recurrence ?? null,
        tags: tags.filter((tag) => input.tagIds?.includes(tag.id)),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tasks = [task, ...tasks];
      return { ...task, tags: task.tags.map((tag) => ({ ...tag })) };
    },
    async updateTask(id: string, input: UpdateTask) {
      const current = tasks.find((task) => task.id === id);
      if (!current) throw new Error("browser development task was not found");
      const status = input.status ?? current.status;
      const recurrence = Object.prototype.hasOwnProperty.call(input, "recurrence")
        ? input.recurrence ?? null
        : current.recurrence;
      if (recurrence && tasks.some((task) => task.parentId === id)) throw new Error("recurring tasks cannot have subtasks");
      const { tagIds, ...fields } = input;
      const updated: Task = {
        ...current,
        ...fields,
        status,
        list: status === "active" ? "today" : "backlog",
        completed: status === "completed",
        completedAt: status === "completed" ? current.completedAt ?? now() : null,
        tags: tagIds === undefined ? current.tags : tags.filter((tag) => tagIds.includes(tag.id)),
        updatedAt: now(),
      };
      tasks = tasks.map((task) => task.id === id ? updated : task);
      if (!current.completed && updated.completed) appendNextOccurrence(updated);
      return { ...updated, tags: updated.tags.map((tag) => ({ ...tag })) };
    },
    async reorderTasks(ids, status) {
      const positions = new Map(ids.map((id, position) => [id, position]));
      tasks = tasks.map((task) => positions.has(task.id) && task.status === status
        ? { ...task, position: positions.get(task.id)!, updatedAt: now() }
        : task);
    },
    async listProjects() { return projects.map((project) => ({ ...project })); },
    async saveProject(project) {
      const saved = { ...project, id: project.id.trim() || nextId("browser-project") };
      projects = [...projects.filter((candidate) => candidate.id !== saved.id), saved];
      return { ...saved };
    },
    async listTags() { return tags.map((tag) => ({ ...tag })); },
    async saveTag(tag) {
      const saved = { ...tag, id: tag.id.trim() || nextId("browser-tag") };
      tags = [...tags.filter((candidate) => candidate.id !== saved.id), saved];
      return { ...saved };
    },
    async setTaskCompleted(id, completed) {
      const current = tasks.find((task) => task.id === id);
      tasks = tasks.map((task) => task.id === id ? {
        ...task,
        completed,
        status: completed ? "completed" : task.list === "today" ? "active" : "inbox",
        completedAt: completed ? now() : null,
        updatedAt: now(),
      } : task);
      if (current && !current.completed && completed) {
        const updated = tasks.find((task) => task.id === id);
        if (updated) appendNextOccurrence(updated);
      }
    },
    async moveTask(id, list) {
      tasks = tasks.map((task) => task.id === id ? { ...task, list, status: list === "today" ? "active" : "inbox", completed: false, completedAt: null, updatedAt: now() } : task);
    },
    async listTimerPresets() { return presets.map((preset) => ({ ...preset })); },
    async saveTimerPreset(preset: TimerPreset) {
      const saved = { ...preset, builtIn: false };
      presets = [...presets.filter((candidate) => candidate.id !== saved.id), saved];
      return { ...saved };
    },
    async deleteTimerPreset(id) {
      const preset = presets.find((candidate) => candidate.id === id);
      if (preset?.builtIn) throw new Error("built-in timer presets cannot be deleted");
      if (settings.defaultPresetId === id) throw new Error("default timer preset cannot be deleted");
      if (timer.preset.id === id) throw new Error("active timer preset cannot be deleted");
      presets = presets.filter((candidate) => candidate.id !== id);
    },
    async getTimerState() { return cloneTimer(timer); },
    async listTracks(query?: MusicTrackListQuery) {
      let result = tracks.slice();
      const term = query?.query?.trim().toLocaleLowerCase();
      if (term) result = result.filter((track) => `${track.title} ${track.description}`.toLocaleLowerCase().includes(term));
      if (query?.favorite !== undefined) result = result.filter((track) => track.favorite === query.favorite);
      if (query?.structureFamily) result = result.filter((track) => track.structureFamily === query.structureFamily);
      const sort = query?.sort ?? "created_desc";
      result.sort((left, right) => {
        if (sort === "created_asc") return left.createdAt.localeCompare(right.createdAt);
        if (sort === "title_asc") return left.title.localeCompare(right.title, "ja");
        if (sort === "title_desc") return right.title.localeCompare(left.title, "ja");
        if (sort === "bpm_asc") return left.bpm - right.bpm;
        if (sort === "bpm_desc") return right.bpm - left.bpm;
        return right.createdAt.localeCompare(left.createdAt);
      });
      return result.map((track) => ({ ...track }));
    },
    async renameTrack(id, title) {
      const normalized = title.trim();
      if (normalized.length < 1 || normalized.length > 100) throw new Error("track title must be 1 to 100 characters");
      const current = tracks.find((track) => track.id === id);
      if (!current) throw new Error("browser development track was not found");
      const renamed = { ...current, title: normalized };
      tracks = tracks.map((track) => track.id === id ? renamed : track);
      return { ...renamed };
    },
    async deleteTracks(ids) {
      const unique = [...new Set(ids)];
      if (unique.length > 200) throw new Error("at most 200 tracks can be deleted at once");
      const existing = new Set(tracks.filter((track) => unique.includes(track.id)).map((track) => track.id));
      const unlinkedChildIds: string[] = [];
      tracks = tracks
        .filter((track) => !existing.has(track.id))
        .map((track) => {
          if (track.parentTrackId && existing.has(track.parentTrackId)) {
            unlinkedChildIds.push(track.id);
            return { ...track, parentTrackId: null };
          }
          return track;
        });
      return { deletedIds: [...existing], unlinkedChildIds };
    },
    async getSettings() { return { ...settings }; },
    async saveSettings(nextSettings) {
      settings = { ...nextSettings };
      return { ...settings };
    },
    async runtimeDiagnostics(): Promise<RuntimeDiagnostic[]> {
      return [
        { component: "sqlite", status: "ok", message: "Browser development uses an in-memory store" },
        { component: "codex", status: "warning", message: "Browser development uses a fixed local ChucK draft" },
      ];
    },
    async openDataDirectory() {},
    async generateTrack(request: MusicGenerationRequest, onProgress) {
      const epoch = ++generationEpoch;
      onProgress?.({ phase: "started" });
      onProgress?.({ phase: "coding" });
      await Promise.resolve();
      if (epoch !== generationEpoch) throw new Error("music generation was cancelled");
      onProgress?.({ phase: "validating" });
      const recipe = "version" in request ? request as MusicRecipeV1 : null;
      const legacy = recipe ? null : request as LegacyMusicGenerationRequest;
      const draft: MusicDraft = {
        id: nextId("browser-draft"),
        parentTrackId: null,
        title: "ブラウザで調合した音楽",
        description: "開発UI確認用の固定ChucKトラック",
        theme: recipe ? "mood-alchemy" : legacy!.theme,
        arrangement: recipe ? "ambient" : legacy!.arrangement,
        brightness: recipe ? "medium" : legacy!.brightness,
        density: recipe ? "medium" : legacy!.density,
        motion: recipe ? "low" : legacy!.motion,
        bpm: 60,
        tailSeconds: 2,
        chuckSource: SAFE_CHUCK_SOURCE,
        sourceSha256: SAFE_CHUCK_SHA256,
        canonicalSeed: 42,
        audioValidation: timer.phase === "focus" && (timer.status === "running" || timer.status === "paused")
          ? "deferred_until_focus_ends"
          : "pending",
        recipeVersion: recipe?.version ?? null,
        recipeJson: recipe ? JSON.stringify(recipe) : null,
        structureFamily: recipe ? "ambient" : legacy!.arrangement,
      };
      drafts.clear();
      drafts.set(draft.id, draft);
      return { ...draft };
    },
    async cancelMusicGeneration() { generationEpoch += 1; },
    async confirmDraftValidation(draftId: string, _report: DraftValidationReport) {
      const draft = drafts.get(draftId);
      if (!draft) throw new Error("browser development draft was not found");
      const validated: MusicDraft = { ...draft, audioValidation: "passed" };
      drafts.set(draftId, validated);
      return { ...validated };
    },
    async discardDraft(draftId) { drafts.delete(draftId); },
    async saveDraft(draftId) {
      const draft = drafts.get(draftId);
      if (!draft || draft.audioValidation !== "passed") throw new Error("browser development draft is not ready to save");
      const track: MusicTrack = {
        id: nextId("browser-track"),
        parentTrackId: draft.parentTrackId,
        title: draft.title,
        description: draft.description,
        theme: draft.theme,
        arrangement: draft.arrangement,
        brightness: draft.brightness,
        density: draft.density,
        motion: draft.motion,
        bpm: draft.bpm,
        tailSeconds: draft.tailSeconds,
        sourcePath: `browser-dev://${draft.id}.ck`,
        sourceSha256: draft.sourceSha256,
        canonicalSeed: draft.canonicalSeed,
        rating: null,
        favorite: false,
        recipeVersion: draft.recipeVersion,
        recipeJson: draft.recipeJson,
        structureFamily: draft.structureFamily,
        createdAt: now(),
      };
      tracks = [track, ...tracks];
      drafts.delete(draftId);
      return { ...track };
    },
    async getTrackSource(trackId) {
      const track = tracks.find((candidate) => candidate.id === trackId);
      if (!track) throw new Error("browser development track was not found");
      return { chuckSource: SAFE_CHUCK_SOURCE, sourceSha256: track.sourceSha256 };
    },
    async timerDispatch(event: TimerEvent, presetId: string) {
      const selectedPreset = presets.find((preset) => preset.id === presetId);
      if (event.type === "select_preset") {
        if (!selectedPreset) throw new Error(`timer preset not found: ${presetId}`);
        if (timer.status !== "idle" && timer.status !== "completed") throw new Error("timer preset can only be selected while idle");
        timer = { ...timer, preset: selectedPreset, status: "idle", remainingSeconds: selectedPreset.focusMinutes * 60, deadlineMs: null };
      } else if (event.type === "start") {
        if (!selectedPreset) throw new Error(`timer preset not found: ${presetId}`);
        if ((timer.status === "idle" || timer.status === "completed") && JSON.stringify(timer.preset) !== JSON.stringify(selectedPreset)) {
          timer = {
            preset: selectedPreset,
            phase: "focus",
            status: "idle",
            remainingSeconds: selectedPreset.focusMinutes * 60,
            completedFocusCycles: 0,
            deadlineMs: null,
          };
        }
        timer = { ...timer, status: "running", deadlineMs: event.nowMs + timer.remainingSeconds * 1_000 };
      } else if (event.type === "resume") {
        timer = { ...timer, status: "running", deadlineMs: event.nowMs + timer.remainingSeconds * 1_000 };
      } else if (event.type === "pause") {
        const remainingSeconds = timer.deadlineMs === null
          ? timer.remainingSeconds
          : Math.max(0, Math.ceil((timer.deadlineMs - event.nowMs) / 1_000));
        timer = { ...timer, status: "paused", remainingSeconds, deadlineMs: null };
      } else if (event.type === "end") {
        timer = { ...timer, phase: "focus", status: "completed", remainingSeconds: timer.preset.focusMinutes * 60, deadlineMs: null };
      } else if (event.type === "start_break") {
        const longBreak = timer.completedFocusCycles % timer.preset.cyclesBeforeLongBreak === 0;
        const phase = longBreak ? "long_break" : "short_break";
        const breakMinutes = longBreak ? timer.preset.longBreakMinutes : timer.preset.shortBreakMinutes;
        timer = { ...timer, phase, status: "running", remainingSeconds: breakMinutes * 60, deadlineMs: event.nowMs + breakMinutes * 60_000 };
      } else if (event.type === "tick" && timer.deadlineMs !== null) {
        tickTimer(event.nowMs);
      }
      publishTimer();
      reconcileTimerScheduler();
      return cloneTimer(timer);
    },
    async startFocus() { return { id: nextId("browser-focus") }; },
    async finishFocus() {},
    async rateTrack(id, rating, favorite) {
      tracks = tracks.map((track) => track.id === id ? { ...track, rating, favorite } : track);
    },
    async saveVariation(trackId, seed) {
      const parent = tracks.find((track) => track.id === trackId);
      if (!parent) throw new Error("browser development track was not found");
      const variation: MusicTrack = {
        ...parent,
        id: nextId("browser-track"),
        parentTrackId: parent.id,
        title: `${parent.title} Variation`,
        canonicalSeed: seed,
        createdAt: now(),
      };
      tracks = [variation, ...tracks];
      return { ...variation };
    },
    async subscribeTimerState(listener) {
      timerListeners.add(listener);
      reconcileTimerScheduler();
      return () => {
        timerListeners.delete(listener);
        reconcileTimerScheduler();
      };
    },
    async subscribeAudioStop(listener) {
      audioStopListeners.add(listener);
      return () => { audioStopListeners.delete(listener); };
    },
  };
}
