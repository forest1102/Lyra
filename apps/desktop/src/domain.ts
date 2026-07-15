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
export type MusicIntensity = "low" | "medium" | "high";

export interface MusicGenerationRequest {
  theme: MusicTheme;
  brightness: MusicIntensity;
  density: MusicIntensity;
  motion: MusicIntensity;
}

export interface MusicGenerationProgress {
  phase: "started" | "coding" | "validating" | "previewing";
}

export type TrackRating = "good" | "poor" | null;

export interface MusicPlaybackState {
  status: "stopped" | "playing" | "paused";
  trackId: string | null;
}

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
