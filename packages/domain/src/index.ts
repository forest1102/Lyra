export type TaskList = "today" | "backlog";

export interface Task {
  id: string;
  title: string;
  list: TaskList;
  completed: boolean;
  estimatedPomodoros: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  id: string;
  title: string;
  list: TaskList;
  estimatedPomodoros?: number;
  now: string;
}

export function createTask(input: CreateTaskInput): Task {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 200) {
    throw new Error("title must contain 1 to 200 characters");
  }
  if (input.estimatedPomodoros !== undefined &&
      (!Number.isInteger(input.estimatedPomodoros) ||
       input.estimatedPomodoros < 1 || input.estimatedPomodoros > 99)) {
    throw new Error("estimatedPomodoros must be an integer from 1 to 99");
  }
  return {
    id: input.id,
    title,
    list: input.list,
    completed: false,
    estimatedPomodoros: input.estimatedPomodoros ?? null,
    createdAt: input.now,
    updatedAt: input.now
  };
}

export interface FocusCompletionInput {
  sessionId: string;
  taskIds: string[];
  completedTaskIds: string[];
  elapsedSeconds: number;
  endedAt: string;
}

export interface FocusCompletion {
  sessionId: string;
  elapsedSeconds: number;
  endedAt: string;
  focusCompletions: 1;
  taskUpdates: Array<{ taskId: string; completed: boolean }>;
}

export function completeFocusSession(input: FocusCompletionInput): FocusCompletion {
  const completed = new Set(input.completedTaskIds);
  return {
    sessionId: input.sessionId,
    elapsedSeconds: input.elapsedSeconds,
    endedAt: input.endedAt,
    focusCompletions: 1,
    taskUpdates: input.taskIds.map((taskId) => ({
      taskId,
      completed: completed.has(taskId)
    }))
  };
}

export interface TimerPreset {
  id: string;
  name: string;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
  builtIn: boolean;
}

export const BUILTIN_PRESETS: readonly TimerPreset[] = [
  {
    id: "sprint",
    name: "Sprint",
    focusMinutes: 15,
    shortBreakMinutes: 3,
    longBreakMinutes: 10,
    cyclesBeforeLongBreak: 4,
    builtIn: true
  },
  {
    id: "standard",
    name: "Standard",
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLongBreak: 4,
    builtIn: true
  },
  {
    id: "deep-focus",
    name: "Deep Focus",
    focusMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 20,
    cyclesBeforeLongBreak: 3,
    builtIn: true
  }
] as const;

export type TimerPhase = "focus" | "short_break" | "long_break";
export type TimerStatus = "idle" | "running" | "paused" | "awaiting_break" | "completed";

export interface TimerState {
  preset: TimerPreset;
  phase: TimerPhase;
  status: TimerStatus;
  remainingSeconds: number;
  completedFocusCycles: number;
  deadlineMs: number | null;
}

export type TimerEvent =
  | { type: "start"; nowMs: number }
  | { type: "tick"; nowMs: number }
  | { type: "pause"; nowMs: number }
  | { type: "resume"; nowMs: number }
  | { type: "start_break"; nowMs: number }
  | { type: "end"; nowMs: number };

export function createTimer(preset: TimerPreset): TimerState {
  return {
    preset,
    phase: "focus",
    status: "idle",
    remainingSeconds: preset.focusMinutes * 60,
    completedFocusCycles: 0,
    deadlineMs: null
  };
}

function runningWithDeadline(state: TimerState, nowMs: number): TimerState {
  return {
    ...state,
    status: "running",
    deadlineMs: nowMs + state.remainingSeconds * 1_000
  };
}

export function transitionTimer(state: TimerState, event: TimerEvent): TimerState {
  switch (event.type) {
    case "start":
      return state.phase === "focus" && (state.status === "idle" || state.status === "completed")
        ? runningWithDeadline(state, event.nowMs)
        : state;
    case "pause": {
      if (state.status !== "running" || state.deadlineMs === null) return state;
      return {
        ...state,
        status: "paused",
        remainingSeconds: Math.max(0, Math.ceil((state.deadlineMs - event.nowMs) / 1_000)),
        deadlineMs: null
      };
    }
    case "resume":
      return state.status === "paused" ? runningWithDeadline(state, event.nowMs) : state;
    case "tick": {
      if (state.status !== "running" || state.deadlineMs === null) return state;
      const remainingSeconds = Math.max(0, Math.ceil((state.deadlineMs - event.nowMs) / 1_000));
      if (remainingSeconds > 0) return { ...state, remainingSeconds };
      if (state.phase === "focus") {
        return {
          ...state,
          status: "awaiting_break",
          remainingSeconds: 0,
          deadlineMs: null,
          completedFocusCycles: state.completedFocusCycles + 1
        };
      }
      return {
        ...state,
        phase: "focus",
        status: "completed",
        remainingSeconds: state.preset.focusMinutes * 60,
        deadlineMs: null
      };
    }
    case "start_break": {
      if (state.status !== "awaiting_break") return state;
      const isLong = state.completedFocusCycles % state.preset.cyclesBeforeLongBreak === 0;
      const phase = isLong ? "long_break" : "short_break";
      const remainingSeconds = (isLong
        ? state.preset.longBreakMinutes
        : state.preset.shortBreakMinutes) * 60;
      return runningWithDeadline({ ...state, phase, remainingSeconds }, event.nowMs);
    }
    case "end":
      return { ...state, status: "completed", deadlineMs: null };
  }
}

export const MUSIC_THEMES = [
  "deep-space",
  "rainy-cabin",
  "minimal-pulse",
  "organic-drift"
] as const;
export type MusicTheme = typeof MUSIC_THEMES[number];
export type MusicIntensity = "low" | "medium" | "high";

export interface MusicGenerationRequest {
  theme: MusicTheme;
  brightness: MusicIntensity;
  density: MusicIntensity;
  motion: MusicIntensity;
}

export interface MusicGenerationResultV1 {
  schemaVersion: 1;
  title: string;
  description: string;
  bpm: number;
  tailSeconds: number;
  supercolliderSource: string;
}

export function parseMusicGenerationResult(value: unknown): MusicGenerationResultV1 {
  if (typeof value !== "object" || value === null) throw new Error("result must be an object");
  const result = value as Record<string, unknown>;
  if (result.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (typeof result.title !== "string" || result.title.length < 1 || result.title.length > 60) {
    throw new Error("title must contain 1 to 60 characters");
  }
  if (typeof result.description !== "string" ||
      result.description.length < 1 || result.description.length > 240) {
    throw new Error("description must contain 1 to 240 characters");
  }
  if (typeof result.bpm !== "number" || result.bpm < 40 || result.bpm > 120) {
    throw new Error("bpm must be between 40 and 120");
  }
  if (typeof result.tailSeconds !== "number" || result.tailSeconds < 0 || result.tailSeconds > 8) {
    throw new Error("tailSeconds must be between 0 and 8");
  }
  if (typeof result.supercolliderSource !== "string" ||
      new TextEncoder().encode(result.supercolliderSource).byteLength > 48 * 1024) {
    throw new Error("supercolliderSource must not exceed 48 KiB");
  }
  return result as unknown as MusicGenerationResultV1;
}

export interface SourcePolicyResult {
  valid: boolean;
  errors: string[];
  synthDefNames: string[];
}

const FORBIDDEN_SC_TOKENS = [
  ".add", ".play", "Server", "Buffer", "File", "Pipe", "UnixCmd",
  "Routine", "fork", "Pfunc", "Plazy", "SoundIn", "DiskIn", "BufRd", "GVerb"
] as const;

export function validateSuperColliderSource(source: string): SourcePolicyResult {
  const errors: string[] = [];
  for (const token of FORBIDDEN_SC_TOKENS) {
    if (source.includes(token)) errors.push(`forbidden token: ${token}`);
  }
  if (!source.includes("~lyraTrack")) errors.push("missing ~lyraTrack assignment");
  if (!source.includes("synthDefs:") || !source.includes("pattern:")) {
    errors.push("track must contain synthDefs and pattern");
  }
  if (!source.includes("EnvGen") || !source.includes("Done.freeSelf")) {
    errors.push("each track requires EnvGen and Done.freeSelf");
  }
  if (/\\(?:out|group)\b/.test(source)) {
    errors.push("pattern cannot set out or group");
  }
  const synthDefNames = [...source.matchAll(/SynthDef\s*\(\s*\\(lyra_voice_[1-4])\b/g)]
    .map((match) => match[1]);
  if (synthDefNames.length < 1 || synthDefNames.length > 4) {
    errors.push("track must define 1 to 4 SynthDefs");
  }
  if (synthDefNames.some((name, index) => synthDefNames.indexOf(name) !== index)) {
    errors.push("SynthDef names must be unique");
  }
  return { valid: errors.length === 0, errors, synthDefNames };
}

export type TrackRating = "good" | "poor" | null;

export interface MusicTrack {
  id: string;
  parentTrackId: string | null;
  title: string;
  description: string;
  theme: MusicTheme;
  brightness: MusicIntensity;
  density: MusicIntensity;
  motion: MusicIntensity;
  bpm: number;
  tailSeconds: number;
  sourcePath: string;
  sourceSha256: string;
  canonicalSeed: number;
  rating: TrackRating;
  favorite: boolean;
  createdAt: string;
}

export interface MusicDraft {
  id: string;
  parentTrackId: string | null;
  title: string;
  description: string;
  theme: MusicTheme;
  brightness: MusicIntensity;
  density: MusicIntensity;
  motion: MusicIntensity;
  bpm: number;
  tailSeconds: number;
  supercolliderSource: string;
  sourceSha256: string;
  canonicalSeed: number;
  audioValidation: "required" | "deferred_until_focus_ends" | "passed";
}

export interface TaskRepository {
  listTasks(list?: TaskList): Promise<Task[]>;
  addTask(input: Pick<Task, "title" | "list"> & { estimatedPomodoros?: number }): Promise<Task>;
  updateTask(task: Task): Promise<Task>;
}

export interface TimerService {
  getState(): Promise<TimerState>;
  dispatch(event: TimerEvent): Promise<TimerState>;
}

export interface MusicGenerationService {
  generate(input: MusicGenerationRequest): Promise<MusicDraft>;
}

export interface MusicPlaybackService {
  play(trackId: string, seed?: number): Promise<void>;
  switchTo(trackId: string | null, seed?: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  setVolume(volume: number): Promise<void>;
}
