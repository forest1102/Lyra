// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { BUILTIN_PRESETS, type TimerState } from "../domain";
import { desktopBridge, type DesktopBridge } from "../services/desktop";
import { LyraProvider, useLyra } from "./LyraContext";

afterEach(cleanup);

const initialTimer: TimerState = {
  preset: BUILTIN_PRESETS[1],
  phase: "focus",
  status: "idle",
  remainingSeconds: 1_500,
  completedFocusCycles: 0,
  deadlineMs: null
};

function Probe() {
  const lyra = useLyra();
  return (
    <div>
      <span>{lyra.ready ? "ready" : "loading"}</span>
      <span>{lyra.startupError ?? "no-error"}</span>
      <span>{lyra.musicError ?? "no-music-error"}</span>
      <span>{lyra.timer.remainingSeconds}</span>
      <span>{lyra.timer.status}</span>
      <span>{lyra.musicPlayback.status}</span>
      <span>{lyra.preset.id}</span>
      <button onClick={() => void lyra.retryStartup()}>retry</button>
      <button onClick={() => void lyra.stopMusic()}>stop-music</button>
      <button onClick={() => void lyra.dispatchTimer({ type: "start", nowMs: 42 })}>start-timer</button>
      <button onClick={() => void lyra.selectPreset(BUILTIN_PRESETS[0])}>select-sprint</button>
    </div>
  );
}

function wrapper(bridge: DesktopBridge) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <LyraProvider bridge={bridge}>{children}</LyraProvider>;
  };
}

function fakeBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    ...desktopBridge,
    listTasks: vi.fn().mockResolvedValue([]),
    listTracks: vi.fn().mockResolvedValue([]),
    listTimerPresets: vi.fn().mockResolvedValue(BUILTIN_PRESETS),
    getTimerState: vi.fn().mockResolvedValue(initialTimer),
    subscribeTimerState: vi.fn().mockResolvedValue(vi.fn()),
    subscribeMusicError: vi.fn().mockResolvedValue(vi.fn()),
    subscribeMusicState: vi.fn().mockResolvedValue(vi.fn()),
    startFocus: vi.fn().mockResolvedValue({ id: "session-1" }),
    ...overrides
  };
}

test("起動データを読み込みイベントでタイマーを同期し購読解除する", async () => {
  let onTimer: ((state: TimerState) => void) | undefined;
  let onMusicError: ((message: string) => void) | undefined;
  const stopTimer = vi.fn();
  const stopMusicError = vi.fn();
  const stopMusicState = vi.fn();
  const bridge = fakeBridge({
    subscribeTimerState: vi.fn(async (listener) => {
      onTimer = listener;
      return stopTimer;
    }),
    subscribeMusicError: vi.fn(async (listener) => {
      onMusicError = listener;
      return stopMusicError;
    }),
    subscribeMusicState: vi.fn(async () => stopMusicState)
  });

  const view = render(<Probe />, { wrapper: wrapper(bridge) });

  await screen.findByText("ready");
  act(() => onTimer?.({ ...initialTimer, remainingSeconds: 1_234 }));
  expect(screen.getByText("1234")).toBeInTheDocument();
  act(() => onMusicError?.("scsynth stopped"));
  expect(screen.getByText("scsynth stopped")).toBeInTheDocument();

  view.unmount();
  await waitFor(() => {
    expect(stopTimer).toHaveBeenCalledOnce();
    expect(stopMusicError).toHaveBeenCalledOnce();
    expect(stopMusicState).toHaveBeenCalledOnce();
  });
});

test("起動失敗を表示し再試行できる", async () => {
  const listTasks = vi
    .fn()
    .mockRejectedValueOnce(new Error("database unavailable"))
    .mockResolvedValueOnce([]);
  const bridge = fakeBridge({ listTasks });

  render(<Probe />, { wrapper: wrapper(bridge) });

  await screen.findByText("database unavailable");
  await act(async () => screen.getByRole("button", { name: "retry" }).click());
  await screen.findByText("ready");
  expect(listTasks).toHaveBeenCalledTimes(2);
});

test("Event購読の失敗後に再試行で購読を再確立する", async () => {
  let onTimer: ((state: TimerState) => void) | undefined;
  const subscribeTimerState = vi
    .fn()
    .mockRejectedValueOnce(new Error("event listener unavailable"))
    .mockImplementationOnce(async (listener: (state: TimerState) => void) => {
      onTimer = listener;
      return vi.fn();
    });
  const bridge = fakeBridge({ subscribeTimerState });

  render(<Probe />, { wrapper: wrapper(bridge) });

  await screen.findByText("event listener unavailable");
  await act(async () => screen.getByRole("button", { name: "retry" }).click());
  await screen.findByText("ready");
  await waitFor(() => expect(subscribeTimerState).toHaveBeenCalledTimes(2));

  act(() => onTimer?.({ ...initialTimer, remainingSeconds: 777 }));
  expect(screen.getByText("777")).toBeInTheDocument();
});

test("タイマー停止中でも音楽を明示的に停止できる", async () => {
  let onMusicState: ((state: { status: "stopped" | "playing" | "paused"; trackId: string | null }) => void) | undefined;
  const playback = vi.fn().mockResolvedValue(undefined);
  const bridge = fakeBridge({
    playback,
    subscribeMusicState: vi.fn(async (listener) => {
      onMusicState = listener;
      return vi.fn();
    })
  });
  render(<Probe />, { wrapper: wrapper(bridge) });

  await screen.findByText("ready");
  act(() => onMusicState?.({ status: "playing", trackId: "track-1" }));
  screen.getByRole("button", { name: "stop-music" }).click();

  await waitFor(() => expect(playback).toHaveBeenCalledWith("stop"));
  expect(screen.getByText("playing")).toBeInTheDocument();
  act(() => onMusicState?.({ status: "stopped", trackId: null }));
  expect(screen.getByText("stopped")).toBeInTheDocument();
});

test("タイマー操作の戻り値ではなく状態Eventで表示を更新する", async () => {
  let onTimer: ((state: TimerState) => void) | undefined;
  const running = { ...initialTimer, status: "running" as const, deadlineMs: 1000 };
  const bridge = fakeBridge({
    timerDispatch: vi.fn().mockResolvedValue(running),
    subscribeTimerState: vi.fn(async (listener) => {
      onTimer = listener;
      return vi.fn();
    })
  });
  render(<Probe />, { wrapper: wrapper(bridge) });

  await screen.findByText("ready");
  screen.getByRole("button", { name: "start-timer" }).click();
  await waitFor(() => expect(bridge.timerDispatch).toHaveBeenCalled());
  expect(screen.getByText("idle")).toBeInTheDocument();
  act(() => onTimer?.(running));
  expect(screen.getByText("running")).toBeInTheDocument();
});

test("プリセット選択をRustへ送り状態Eventで時計と選択を同期する", async () => {
  let onTimer: ((state: TimerState) => void) | undefined;
  const bridge = fakeBridge({
    timerDispatch: vi.fn().mockResolvedValue(initialTimer),
    subscribeTimerState: vi.fn(async (listener) => {
      onTimer = listener;
      return vi.fn();
    })
  });
  render(<Probe />, { wrapper: wrapper(bridge) });

  await screen.findByText("ready");
  screen.getByRole("button", { name: "select-sprint" }).click();
  await waitFor(() => expect(bridge.timerDispatch).toHaveBeenCalledWith(
    { type: "select_preset" },
    "sprint"
  ));
  expect(screen.getByText("standard")).toBeInTheDocument();
  expect(screen.getByText("1500")).toBeInTheDocument();

  act(() => onTimer?.({
    ...initialTimer,
    preset: BUILTIN_PRESETS[0],
    remainingSeconds: 900
  }));
  expect(screen.getByText("sprint")).toBeInTheDocument();
  expect(screen.getByText("900")).toBeInTheDocument();
});
