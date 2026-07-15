import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TimerState } from "../domain";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  emit: vi.fn(),
  channels: [] as Array<{ onmessage?: (message: unknown) => void }>
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage?: (message: unknown) => void;

    constructor() {
      mocks.channels.push(this);
    }
  }
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen, emit: mocks.emit }));

import { desktopBridge } from "./desktop";

const timerState: TimerState = {
  preset: {
    id: "standard",
    name: "Standard",
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    cyclesBeforeLongBreak: 4,
    builtIn: true
  },
  phase: "focus",
  status: "running",
  remainingSeconds: 1_499,
  completedFocusCycles: 0,
  deadlineMs: 1_000_000
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  mocks.emit.mockReset();
  mocks.channels.length = 0;
});

describe("デスクトップIPC", () => {
  test("現在のタイマー状態をRustから取得する", async () => {
    mocks.invoke.mockResolvedValue(timerState);

    await expect(desktopBridge.getTimerState()).resolves.toEqual(timerState);
    expect(mocks.invoke).toHaveBeenCalledWith("get_timer_state", undefined);
  });

  test("タイマーイベントのpayloadを購読者へ渡して購読解除できる", async () => {
    const listener = vi.fn();
    const unlisten = vi.fn();
    mocks.listen.mockImplementation(async (_event, handler) => {
      handler({ event: "timer://state", id: 1, payload: timerState });
      return unlisten;
    });

    const stop = await desktopBridge.subscribeTimerState(listener);

    expect(mocks.listen).toHaveBeenCalledWith("timer://state", expect.any(Function));
    expect(listener).toHaveBeenCalledWith(timerState);
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  test("ネイティブの停止要求をクライアント音声エンジンへ渡す", async () => {
    const listener = vi.fn();
    mocks.listen.mockImplementation(async (_event, handler) => {
      handler({ event: "audio://stop", id: 1, payload: null });
      return vi.fn();
    });

    await desktopBridge.subscribeAudioStop(listener);

    expect(listener).toHaveBeenCalledOnce();
  });

  test("タイマー操作だけを双方向Eventで送る", async () => {
    let onResult: ((event: { payload: { requestId: string; ok: boolean; data?: unknown } }) => void) | undefined;
    mocks.listen.mockImplementation(async (event, handler) => {
      if (event === "ipc://result") onResult = handler;
      return vi.fn();
    });
    mocks.emit.mockResolvedValue(undefined);

    const timerPending = desktopBridge.timerDispatch({ type: "start", nowMs: 42 }, "standard");
    await vi.waitFor(() => expect(mocks.emit).toHaveBeenCalledWith("timer://control", expect.objectContaining({
      event: { type: "start", nowMs: 42 },
      presetId: "standard"
    })));
    const timerRequest = mocks.emit.mock.calls[0][1] as { requestId: string };
    onResult?.({ payload: { requestId: timerRequest.requestId, ok: true, data: timerState } });
    await expect(timerPending).resolves.toEqual(timerState);

    expect(mocks.invoke).not.toHaveBeenCalledWith("timer_dispatch", expect.anything());
  });

  test("BGM生成の進捗をChannelから購読する", async () => {
    const draft = { id: "draft-1" };
    const onProgress = vi.fn();
    mocks.invoke.mockImplementation(async (_command, args) => {
      const channel = (args as { onProgress: { onmessage?: (message: unknown) => void } }).onProgress;
      channel.onmessage?.({ phase: "coding" });
      return draft;
    });

    await expect(desktopBridge.generateTrack({
      theme: "deep-space",
      arrangement: "ambient",
      brightness: "medium",
      density: "medium",
      motion: "low"
    }, onProgress)).resolves.toBe(draft);

    expect(mocks.invoke).toHaveBeenCalledWith("generate_music", expect.objectContaining({
      onProgress: mocks.channels[0]
    }));
    expect(onProgress).toHaveBeenCalledWith({ phase: "coding" });

  });

  test("進行中のBGM生成をRustへ中止要求できる", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await desktopBridge.cancelMusicGeneration();

    expect(mocks.invoke).toHaveBeenCalledWith("cancel_music_generation", undefined);
  });

  test("検証レポートと曲ソースをTauri commandで交換する", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const report = { durationMs: 5000 as const, elapsedAudioSeconds: 5, peak: 0.8, nonSilentMs: 300, nonFiniteSamples: 0, processorErrors: 0 };
    await desktopBridge.confirmDraftValidation("draft-1", report);
    await desktopBridge.getTrackSource("track-1");

    expect(mocks.invoke).toHaveBeenCalledWith("confirm_music_draft_validation", { draftId: "draft-1", report });
    expect(mocks.invoke).toHaveBeenCalledWith("get_music_track_source", { trackId: "track-1" });
  });
});
