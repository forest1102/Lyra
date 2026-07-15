// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { BUILTIN_PRESETS, type MusicDraft, type MusicPlaybackState, type TimerState } from "../domain";
import type { AudioEngine } from "../services/audioEngine";
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
      <button onClick={() => void lyra.generateTrack({ theme: "deep-space", arrangement: "ambient", brightness: "medium", density: "medium", motion: "low" })}>generate-track</button>
      {lyra.draft ? <button onClick={() => void lyra.previewDraft(lyra.draft!).catch(() => undefined)}>preview-draft</button> : null}
      <button onClick={() => void lyra.selectPreset(BUILTIN_PRESETS[0])}>select-sprint</button>
    </div>
  );
}

class FakeAudioEngine {
  state: MusicPlaybackState = { status: "stopped", trackId: null, disabled: false };
  listener?: (state: MusicPlaybackState) => void;
  play = vi.fn(async () => undefined);
  pause = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  stop = vi.fn(async () => { this.emit({ status: "stopped", trackId: null, disabled: this.state.disabled }); });
  resetFocusSession = vi.fn();
  prepareForUserGesture = vi.fn();
  validateSource = vi.fn(async () => ({ durationMs: 5000 as const, elapsedAudioSeconds: 5, peak: 0.5, nonSilentMs: 500, nonFiniteSamples: 0, processorErrors: 0 }));
  getState = () => this.state;
  subscribe = (listener: (state: MusicPlaybackState) => void) => {
    this.listener = listener;
    listener(this.state);
    return () => { this.listener = undefined; };
  };
  emit(state: MusicPlaybackState) { this.state = state; this.listener?.(state); }
}

function wrapper(
  bridge: DesktopBridge,
  audioEngine = new FakeAudioEngine(),
  prepareValidation = vi.fn(),
) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <LyraProvider bridge={bridge} audioEngine={audioEngine as unknown as AudioEngine} prepareValidation={prepareValidation}>{children}</LyraProvider>;
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
    subscribeAudioStop: vi.fn().mockResolvedValue(vi.fn()),
    startFocus: vi.fn().mockResolvedValue({ id: "session-1" }),
    ...overrides
  };
}

test("起動データを読み込みタイマーEventとクライアント音声状態を同期する", async () => {
  let onTimer: ((state: TimerState) => void) | undefined;
  let onAudioStop: (() => void) | undefined;
  const stopTimer = vi.fn();
  const stopAudio = vi.fn();
  const engine = new FakeAudioEngine();
  const bridge = fakeBridge({
    subscribeTimerState: vi.fn(async (listener) => {
      onTimer = listener;
      return stopTimer;
    }),
    subscribeAudioStop: vi.fn(async (listener) => {
      onAudioStop = listener;
      return stopAudio;
    })
  });

  const view = render(<Probe />, { wrapper: wrapper(bridge, engine) });

  await screen.findByText("ready");
  act(() => onTimer?.({ ...initialTimer, remainingSeconds: 1_234 }));
  expect(screen.getByText("1234")).toBeInTheDocument();
  act(() => engine.emit({ status: "playing", trackId: "track-1", disabled: false }));
  expect(screen.getByText("playing")).toBeInTheDocument();
  act(() => onAudioStop?.());
  await waitFor(() => expect(engine.stop).toHaveBeenCalledOnce());

  view.unmount();
  await waitFor(() => {
    expect(stopTimer).toHaveBeenCalledOnce();
    expect(stopAudio).toHaveBeenCalledOnce();
  });
});

test("起動時に音声権限や出力一覧を要求しない", async () => {
  const bridge = fakeBridge();
  render(<Probe />, { wrapper: wrapper(bridge) });

  await screen.findByText("ready");
  expect("requestAudioOutputAccess" in bridge).toBe(false);
  expect("getAudioOutputPreference" in bridge).toBe(false);
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
  const engine = new FakeAudioEngine();
  const bridge = fakeBridge();
  render(<Probe />, { wrapper: wrapper(bridge, engine) });

  await screen.findByText("ready");
  act(() => engine.emit({ status: "playing", trackId: "track-1", disabled: false }));
  screen.getByRole("button", { name: "stop-music" }).click();

  await waitFor(() => expect(engine.stop).toHaveBeenCalledOnce());
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
  const engine = new FakeAudioEngine();
  render(<Probe />, { wrapper: wrapper(bridge, engine) });

  await screen.findByText("ready");
  screen.getByRole("button", { name: "start-timer" }).click();
  expect(engine.prepareForUserGesture).toHaveBeenCalledOnce();
  await waitFor(() => expect(bridge.timerDispatch).toHaveBeenCalled());
  expect(screen.getByText("idle")).toBeInTheDocument();
  act(() => onTimer?.(running));
  expect(screen.getByText("running")).toBeInTheDocument();
});

test("コード生成後の明示的な試聴操作で出力と検証Contextを解除する", async () => {
  let finishGeneration: ((draft: MusicDraft) => void) | undefined;
  const generateTrack = vi.fn(() => new Promise<MusicDraft>((resolve) => { finishGeneration = resolve; }));
  const bridge = fakeBridge({ generateTrack });
  const engine = new FakeAudioEngine();
  const prepareValidation = vi.fn();
  render(<Probe />, { wrapper: wrapper(bridge, engine, prepareValidation) });

  await screen.findByText("ready");
  screen.getByRole("button", { name: "generate-track" }).click();

  expect(engine.prepareForUserGesture).not.toHaveBeenCalled();
  expect(prepareValidation).not.toHaveBeenCalled();

  await act(async () => finishGeneration?.({
    id: "draft-1",
    parentTrackId: null,
    title: "Draft",
    description: "Generated",
    theme: "deep-space",
    arrangement: "ambient",
    brightness: "medium",
    density: "medium",
    motion: "low",
    bpm: 64,
    tailSeconds: 4,
    chuckSource: "Math.srandom(__LYRA_SEED__);",
    sourceSha256: "hash",
    canonicalSeed: 1,
    audioValidation: "pending",
  }));

  (await screen.findByRole("button", { name: "preview-draft" })).click();
  expect(engine.prepareForUserGesture).toHaveBeenCalledOnce();
  expect(prepareValidation).toHaveBeenCalledOnce();
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
