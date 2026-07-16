export type TaskList = "today" | "backlog";
export type TaskStatus = "inbox" | "active" | "completed";
export type TaskPriority = "none" | "low" | "medium" | "high";
export type TaskRecurrence = "daily" | "weekly" | "monthly";

export interface Project {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  title: string;
  list: TaskList;
  completed: boolean;
  estimatedPomodoros: number | null;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string | null;
  parentId: string | null;
  notes: string;
  plannedDate: string | null;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  recurrence: TaskRecurrence | null;
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
}

export interface AddTaskV2 {
  title: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  estimatedPomodoros?: number | null;
  projectId?: string | null;
  parentId?: string | null;
  notes?: string;
  plannedDate?: string | null;
  dueDate?: string | null;
  recurrence?: TaskRecurrence | null;
  tagIds?: string[];
}

export interface UpdateTask {
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  estimatedPomodoros?: number | null;
  projectId?: string | null;
  notes?: string;
  plannedDate?: string | null;
  dueDate?: string | null;
  recurrence?: TaskRecurrence | null;
  tagIds?: string[];
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
  { id: "sprint", name: "Sprint", focusMinutes: 15, shortBreakMinutes: 3, longBreakMinutes: 10, cyclesBeforeLongBreak: 4, builtIn: true },
  { id: "standard", name: "Standard", focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLongBreak: 4, builtIn: true },
  { id: "deep-focus", name: "Deep Focus", focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20, cyclesBeforeLongBreak: 3, builtIn: true }
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
  | { type: "select_preset" }
  | { type: "start"; nowMs: number }
  | { type: "tick"; nowMs: number }
  | { type: "pause"; nowMs: number }
  | { type: "resume"; nowMs: number }
  | { type: "start_break"; nowMs: number }
  | { type: "end"; nowMs: number };

export const MUSIC_THEMES = ["deep-space", "rainy-cabin", "minimal-pulse", "organic-drift"] as const;
export type MusicTheme = typeof MUSIC_THEMES[number];
export const MUSIC_ARRANGEMENTS = ["ambient", "lofi", "minimal-melody"] as const;
export type MusicArrangement = typeof MUSIC_ARRANGEMENTS[number];
export type MusicStructureFamily = MusicArrangement | "organic-pulse" | "downtempo" | "neoclassical";
export type MusicTrackTheme = MusicTheme | "mood-alchemy";
export type MusicIntensity = "low" | "medium" | "high";

export interface LegacyMusicGenerationRequest {
  theme: MusicTheme;
  arrangement: MusicArrangement;
  brightness: MusicIntensity;
  density: MusicIntensity;
  motion: MusicIntensity;
}

export interface MoodSelection {
  moodId: string;
  weight: number;
}

export interface MusicRecipeV1 {
  version: 1;
  moods: MoodSelection[];
}

export type MusicGenerationRequest = MusicRecipeV1 | LegacyMusicGenerationRequest;

export interface MusicGenerationProgress {
  phase: "started" | "coding" | "validating" | "previewing";
}

export type TrackRating = "good" | "poor" | null;

export interface MusicPlaybackState {
  status: "stopped" | "playing" | "paused";
  trackId: string | null;
  disabled: boolean;
}

export interface DraftValidationReport {
  durationMs: 5000;
  elapsedAudioSeconds: number;
  peak: number;
  nonSilentMs: number;
  nonFiniteSamples: number;
  processorErrors: number;
}

export interface MusicTrackSource {
  chuckSource: string;
  sourceSha256: string;
}

export interface MusicTrack {
  id: string;
  parentTrackId: string | null;
  title: string;
  description: string;
  theme: MusicTrackTheme;
  arrangement: MusicStructureFamily;
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
  recipeVersion: number | null;
  recipeJson: string | null;
  structureFamily: MusicStructureFamily | null;
  createdAt: string;
}

export interface MusicDraft {
  id: string;
  parentTrackId: string | null;
  title: string;
  description: string;
  theme: MusicTrackTheme;
  arrangement: MusicStructureFamily;
  brightness: MusicIntensity;
  density: MusicIntensity;
  motion: MusicIntensity;
  bpm: number;
  tailSeconds: number;
  chuckSource: string;
  sourceSha256: string;
  canonicalSeed: number;
  audioValidation: "pending" | "deferred_until_focus_ends" | "passed" | "failed";
  recipeVersion: number | null;
  recipeJson: string | null;
  structureFamily: MusicStructureFamily;
}

export type MusicTrackSort = "created_desc" | "created_asc" | "title_asc" | "title_desc" | "bpm_asc" | "bpm_desc";

export interface MusicTrackListQuery {
  query?: string;
  favorite?: boolean;
  structureFamily?: string;
  sort?: MusicTrackSort;
}

export interface DeleteMusicTracksResult {
  deletedIds: string[];
  unlinkedChildIds: string[];
  cleanupWarnings?: string[];
}

export interface AppSettingsV1 {
  version: 1;
  closeBehavior: "hide" | "quit";
  launchAtLogin: boolean;
  defaultPresetId: string;
  autoStartBreak: boolean;
  notificationsEnabled: boolean;
  masterVolume: number;
  playSelectedTrackOnFocus: boolean;
  crossfadeSeconds: number;
}

export const DEFAULT_APP_SETTINGS: AppSettingsV1 = {
  version: 1,
  closeBehavior: "hide",
  launchAtLogin: false,
  defaultPresetId: "standard",
  autoStartBreak: false,
  notificationsEnabled: true,
  masterVolume: 1,
  playSelectedTrackOnFocus: true,
  crossfadeSeconds: 2,
};

export type RuntimeDiagnosticComponent = "codex" | "webchuck-assets" | "audio-context" | "worklet" | "sqlite";
export type RuntimeDiagnosticStatus = "ok" | "warning" | "error";

export interface RuntimeDiagnostic {
  component: RuntimeDiagnosticComponent;
  status: RuntimeDiagnosticStatus;
  message: string;
  remediation?: string;
}
