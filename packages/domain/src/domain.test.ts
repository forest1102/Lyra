import { describe, expect, test } from "vitest";
import {
  BUILTIN_PRESETS,
  completeFocusSession,
  createTask,
  createTimer,
  parseMusicGenerationResult,
  transitionTimer,
  validateSuperColliderSource
} from "./index";

describe("tasks and focus sessions", () => {
  test("creates a Today task with an optional estimate", () => {
    const task = createTask({
      id: "task-1",
      title: "Implement timer",
      list: "today",
      estimatedPomodoros: 3,
      now: "2026-07-14T09:00:00.000Z"
    });

    expect(task).toMatchObject({
      id: "task-1",
      title: "Implement timer",
      list: "today",
      estimatedPomodoros: 3,
      completed: false
    });
  });

  test("counts a multi-task focus only once and completes chosen tasks", () => {
    const result = completeFocusSession({
      sessionId: "session-1",
      taskIds: ["task-1", "task-2"],
      completedTaskIds: ["task-2"],
      elapsedSeconds: 1500,
      endedAt: "2026-07-14T10:00:00.000Z"
    });

    expect(result.focusCompletions).toBe(1);
    expect(result.taskUpdates).toEqual([
      { taskId: "task-1", completed: false },
      { taskId: "task-2", completed: true }
    ]);
  });
});

describe("timer", () => {
  test("ships the three approved presets", () => {
    expect(BUILTIN_PRESETS.map(({ name, focusMinutes, shortBreakMinutes }) => [
      name,
      focusMinutes,
      shortBreakMinutes
    ])).toEqual([
      ["Sprint", 15, 3],
      ["Standard", 25, 5],
      ["Deep Focus", 50, 10]
    ]);
  });

  test("requires a manual action before a break begins", () => {
    const running = transitionTimer(
      createTimer(BUILTIN_PRESETS[1]),
      { type: "start", nowMs: 1_000 }
    );
    const finished = transitionTimer(running, {
      type: "tick",
      nowMs: 1_000 + 25 * 60 * 1_000
    });

    expect(finished.status).toBe("awaiting_break");
    expect(finished.phase).toBe("focus");
    expect(finished.remainingSeconds).toBe(0);

    const breakTimer = transitionTimer(finished, {
      type: "start_break",
      nowMs: 1_000 + 25 * 60 * 1_000 + 5_000
    });
    expect(breakTimer).toMatchObject({
      status: "running",
      phase: "short_break",
      remainingSeconds: 5 * 60
    });
  });

  test("pause and resume preserve elapsed focus time", () => {
    let timer = transitionTimer(createTimer(BUILTIN_PRESETS[0]), {
      type: "start",
      nowMs: 0
    });
    timer = transitionTimer(timer, { type: "pause", nowMs: 60_000 });
    expect(timer.remainingSeconds).toBe(14 * 60);
    timer = transitionTimer(timer, { type: "resume", nowMs: 120_000 });
    timer = transitionTimer(timer, { type: "tick", nowMs: 180_000 });
    expect(timer.remainingSeconds).toBe(13 * 60);
  });

  test("starts a new focus after completing a break", () => {
    let timer = transitionTimer(createTimer(BUILTIN_PRESETS[0]), {
      type: "start",
      nowMs: 0
    });
    timer = transitionTimer(timer, { type: "tick", nowMs: 15 * 60 * 1_000 });
    timer = transitionTimer(timer, { type: "start_break", nowMs: 15 * 60 * 1_000 });
    timer = transitionTimer(timer, { type: "tick", nowMs: 18 * 60 * 1_000 });

    expect(timer.status).toBe("completed");
    const nextFocus = transitionTimer(timer, { type: "start", nowMs: 19 * 60 * 1_000 });
    expect(nextFocus).toMatchObject({
      phase: "focus",
      status: "running",
      remainingSeconds: 15 * 60
    });
  });
});

describe("music generation contract", () => {
  test("accepts a valid V1 result", () => {
    const result = parseMusicGenerationResult({
      schemaVersion: 1,
      title: "Nebula Drift",
      description: "A slow, spacious focus loop.",
      bpm: 64,
      tailSeconds: 4,
      supercolliderSource: "(~lyraTrack = (synthDefs: [], pattern: Pseq([1], inf));)"
    });
    expect(result.title).toBe("Nebula Drift");
  });

  test("rejects out-of-range generation metadata", () => {
    expect(() => parseMusicGenerationResult({
      schemaVersion: 1,
      title: "",
      description: "x",
      bpm: 180,
      tailSeconds: 12,
      supercolliderSource: "x"
    })).toThrow(/title/);
  });
});

describe("SuperCollider source policy", () => {
  const validSource = String.raw`(
~lyraTrack = (
  synthDefs: [SynthDef(\lyra_voice_1, { |out=0, amp=0.08, gate=1, pan=0, freq=220|
    var env = EnvGen.kr(Env.asr(0.5, 1, 3), gate, doneAction: Done.freeSelf);
    Out.ar(out, Pan2.ar(SinOsc.ar(freq), pan) * amp * env);
  })],
  pattern: Pbind(\instrument, \lyra_voice_1, \dur, Pseq([1, 2], inf), \amp, 0.08)
);
)`;

  test("accepts a side-effect-free track contract", () => {
    expect(validateSuperColliderSource(validSource)).toEqual({
      valid: true,
      errors: [],
      synthDefNames: ["lyra_voice_1"]
    });
  });

  test.each([".play", "Buffer", "Pfunc", "SoundIn", "fork"])(
    "rejects forbidden token %s",
    (forbidden) => {
      const result = validateSuperColliderSource(`${validSource}\n${forbidden}`);
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain(forbidden);
    }
  );
});
