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

import {
  desktopBridge,
  selectionPlaybackAction
} from "./desktop";

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

  test("音響エラーイベントの文字列を購読者へ渡す", async () => {
    const listener = vi.fn();
    mocks.listen.mockImplementation(async (_event, handler) => {
      handler({ event: "music://error", id: 1, payload: "scsynth stopped" });
      return vi.fn();
    });

    await desktopBridge.subscribeMusicError(listener);

    expect(listener).toHaveBeenCalledWith("scsynth stopped");
  });

  test("タイマーと音楽の操作を双方向Eventで送る", async () => {
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

    const musicPending = desktopBridge.playback("stop");
    await vi.waitFor(() => expect(mocks.emit).toHaveBeenCalledWith("music://control", expect.objectContaining({ action: "stop" })));
    const musicRequest = mocks.emit.mock.calls[1][1] as { requestId: string };
    onResult?.({ payload: { requestId: musicRequest.requestId, ok: true } });
    await expect(musicPending).resolves.toBeUndefined();

    expect(mocks.invoke).not.toHaveBeenCalledWith("timer_dispatch", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("music_playback", expect.anything());
  });

  test("BGM生成と検証の進捗をChannelから購読する", async () => {
    const draft = { id: "draft-1" };
    const onProgress = vi.fn();
    mocks.invoke.mockImplementation(async (_command, args) => {
      const channel = (args as { onProgress: { onmessage?: (message: unknown) => void } }).onProgress;
      channel.onmessage?.({ phase: "coding" });
      return draft;
    });

    await expect(desktopBridge.generateTrack({
      theme: "deep-space",
      brightness: "medium",
      density: "medium",
      motion: "low"
    }, onProgress)).resolves.toBe(draft);

    expect(mocks.invoke).toHaveBeenCalledWith("generate_music", expect.objectContaining({
      onProgress: mocks.channels[0]
    }));
    expect(onProgress).toHaveBeenCalledWith({ phase: "coding" });

    mocks.invoke.mockImplementation(async (_command, args) => {
      const channel = (args as { onProgress: { onmessage?: (message: unknown) => void } }).onProgress;
      channel.onmessage?.({ phase: "validating" });
      return draft;
    });
    await desktopBridge.previewDraft("draft-1", onProgress);

    expect(mocks.invoke).toHaveBeenCalledWith("preview_music_draft", expect.objectContaining({
      onProgress: mocks.channels[1]
    }));
    expect(onProgress).toHaveBeenCalledWith({ phase: "validating" });
  });
});

describe("BGM切替", () => {
  test("無音を選ぶと再生停止を要求する", () => {
    expect(selectionPlaybackAction(null)).toBe("silence");
  });

  test("保存曲を選ぶとクロスフェード切替を要求する", () => {
    expect(selectionPlaybackAction("track-1")).toBe("switch");
  });
});
