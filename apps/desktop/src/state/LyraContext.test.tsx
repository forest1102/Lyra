// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { BUILTIN_PRESETS, DEFAULT_APP_SETTINGS, type MusicDraft, type MusicGenerationProgress, type MusicPlaybackState, type MusicTrack, type Task, type TimerState } from "../domain";
import type { AudioEngine } from "../services/audioEngine";
import { desktopBridge, type DesktopBridge } from "../services/desktop";
import { LyraProvider, useLyra, type LyraState } from "./LyraContext";

afterEach(cleanup);

const initialTimer: TimerState = {
  preset: BUILTIN_PRESETS[1],
  phase: "focus",
  status: "idle",
  remainingSeconds: 1_500,
  completedFocusCycles: 0,
  deadlineMs: null
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function task(id: string, title: string): Task {
  return {
    id,
    title,
    list: "today",
    completed: false,
    estimatedPomodoros: null,
    status: "active",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function Probe() {
  const lyra = useLyra();
  return (
    <div>
      <span>{lyra.ready ? "ready" : "loading"}</span>
      <span>{lyra.startupError ?? "no-error"}</span>
      <span>{lyra.subscriptionError ?? "no-subscription-error"}</span>
      <span>{lyra.musicError ?? "no-music-error"}</span>
      <span>{lyra.timer.remainingSeconds}</span>
      <span>{lyra.timer.status}</span>
      <span>{lyra.musicPlayback.status}</span>
      <span>{lyra.preset.id}</span>
      <span>{lyra.tasks.map((item) => item.title).join(",") || "no-tasks"}</span>
      <button onClick={() => void lyra.retryStartup()}>retry</button>
      <button onClick={() => lyra.retrySubscriptions()}>reconnect</button>
      <button onClick={() => void lyra.stopMusic()}>stop-music</button>
      <button onClick={() => void lyra.dispatchTimer({ type: "start", nowMs: 42 })}>start-timer</button>
      <button onClick={() => void lyra.generateTrack({ theme: "deep-space", arrangement: "ambient", brightness: "medium", density: "medium", motion: "low" })}>generate-track</button>
      {lyra.draft ? <button onClick={() => void lyra.previewDraft(lyra.draft!).catch(() => undefined)}>preview-draft</button> : null}
      <button onClick={() => void lyra.selectPreset(BUILTIN_PRESETS[0])}>select-sprint</button>
    </div>
  );
}

let capturedState: LyraState;
function CaptureState() {
  capturedState = useLyra();
  return <span>{capturedState.ready ? "captured-ready" : "captured-loading"}</span>;
}

function musicDraft(overrides: Partial<MusicDraft> = {}): MusicDraft {
  return {
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
    recipeVersion: null,
    recipeJson: null,
    structureFamily: "ambient",
    ...overrides,
  };
}

function musicTrack(id: string, title: string): MusicTrack {
  return {
    id, parentTrackId: null, title, description: "focus", theme: "mood-alchemy",
    arrangement: "ambient", brightness: "medium", density: "medium", motion: "low",
    bpm: 64, tailSeconds: 4, sourcePath: `/tmp/${id}.ck`, sourceSha256: "hash",
    canonicalSeed: 1, rating: null, favorite: false, recipeVersion: 1,
    recipeJson: '{"version":1,"moods":[]}', structureFamily: "ambient",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
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
  setVolume = vi.fn();
  setCrossfadeSeconds = vi.fn();
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
    listProjects: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(DEFAULT_APP_SETTINGS),
    listTimerPresets: vi.fn().mockResolvedValue(BUILTIN_PRESETS),
    getTimerState: vi.fn().mockResolvedValue(initialTimer),
    subscribeTimerState: vi.fn().mockResolvedValue(vi.fn()),
    subscribeAudioStop: vi.fn().mockResolvedValue(vi.fn()),
    startFocus: vi.fn().mockResolvedValue({ id: "session-1" }),
    finishFocus: vi.fn().mockResolvedValue(undefined),
    discardDraft: vi.fn().mockResolvedValue(undefined),
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

test("StrictModeの二重mountでも各Event購読を一度ずつ解除する", async () => {
  const timerStops = [vi.fn(), vi.fn()];
  const audioStops = [vi.fn(), vi.fn()];
  let timerSubscription = 0;
  let audioSubscription = 0;
  const bridge = fakeBridge({
    subscribeTimerState: vi.fn(async () => timerStops[timerSubscription++]),
    subscribeAudioStop: vi.fn(async () => audioStops[audioSubscription++]),
  });
  const engine = new FakeAudioEngine();

  const view = render(
    <StrictMode>
      <LyraProvider bridge={bridge} audioEngine={engine as unknown as AudioEngine}>
        <Probe />
      </LyraProvider>
    </StrictMode>,
  );

  await screen.findByText("ready");
  await waitFor(() => {
    expect(bridge.subscribeTimerState).toHaveBeenCalledTimes(2);
    expect(bridge.subscribeAudioStop).toHaveBeenCalledTimes(2);
    expect(timerStops[0]).toHaveBeenCalledOnce();
    expect(audioStops[0]).toHaveBeenCalledOnce();
  });

  view.unmount();
  await waitFor(() => {
    expect(timerStops[1]).toHaveBeenCalledOnce();
    expect(audioStops[1]).toHaveBeenCalledOnce();
  });
});

test("StrictModeの古い起動成功が新しい起動データを上書きしない", async () => {
  const first = deferred<Task[]>();
  const second = deferred<Task[]>();
  const listTasks = vi.fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const bridge = fakeBridge({ listTasks });

  render(
    <StrictMode>
      <LyraProvider bridge={bridge} audioEngine={new FakeAudioEngine() as unknown as AudioEngine}>
        <Probe />
      </LyraProvider>
    </StrictMode>,
  );

  await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2));
  await act(async () => second.resolve([task("new", "新しい起動データ")]));
  expect(await screen.findByText("新しい起動データ")).toBeInTheDocument();

  await act(async () => first.resolve([task("old", "古い起動データ")]));
  expect(screen.getByText("新しい起動データ")).toBeInTheDocument();
  expect(screen.queryByText("古い起動データ")).not.toBeInTheDocument();
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

test("重複した起動再試行の古い失敗が新しい成功を上書きしない", async () => {
  const oldRetry = deferred<Task[]>();
  const newRetry = deferred<Task[]>();
  const listTasks = vi.fn()
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => oldRetry.promise)
    .mockImplementationOnce(() => newRetry.promise);
  const bridge = fakeBridge({ listTasks });

  render(<Probe />, { wrapper: wrapper(bridge) });
  await screen.findByText("ready");

  act(() => {
    screen.getByRole("button", { name: "retry" }).click();
    screen.getByRole("button", { name: "retry" }).click();
  });
  await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(3));
  await act(async () => newRetry.resolve([task("new", "最新の再試行データ")]));
  expect(await screen.findByText("最新の再試行データ")).toBeInTheDocument();

  await act(async () => oldRetry.reject(new Error("stale database failure")));
  expect(screen.getByText("ready")).toBeInTheDocument();
  expect(screen.getByText("no-error")).toBeInTheDocument();
});

test("起動データとEvent購読の失敗を別々に保持する", async () => {
  const bridge = fakeBridge({
    listTasks: vi.fn().mockRejectedValue(new Error("database unavailable")),
    subscribeTimerState: vi.fn().mockRejectedValue(new Error("event listener unavailable")),
  });

  render(<Probe />, { wrapper: wrapper(bridge) });

  expect(await screen.findByText("database unavailable")).toBeInTheDocument();
  expect(await screen.findByText("event listener unavailable")).toBeInTheDocument();
});

test("Event購読の再接続は起動データを再読込せずready画面を維持する", async () => {
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
  screen.getByRole("button", { name: "reconnect" }).click();
  await waitFor(() => expect(subscribeTimerState).toHaveBeenCalledTimes(2));
  expect(bridge.listTasks).toHaveBeenCalledOnce();
  expect(screen.getByText("ready")).toBeInTheDocument();

  act(() => onTimer?.({ ...initialTimer, remainingSeconds: 777 }));
  expect(screen.getByText("777")).toBeInTheDocument();
});

test("Event再接続が再び失敗しても起動済み画面を落とさない", async () => {
  const subscribeTimerState = vi.fn()
    .mockRejectedValueOnce(new Error("first listener failure"))
    .mockRejectedValueOnce(new Error("second listener failure"));
  const bridge = fakeBridge({ subscribeTimerState });

  render(<Probe />, { wrapper: wrapper(bridge) });
  expect(await screen.findByText("first listener failure")).toBeInTheDocument();

  screen.getByRole("button", { name: "reconnect" }).click();

  expect(await screen.findByText("second listener failure")).toBeInTheDocument();
  expect(screen.getByText("ready")).toBeInTheDocument();
  expect(bridge.listTasks).toHaveBeenCalledOnce();
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

test("別の曲を試聴して停止しても集中用に選んだ曲を維持する", async () => {
  const selected = musicTrack("selected", "集中用");
  const audition = musicTrack("audition", "試聴用");
  const engine = new FakeAudioEngine();
  const bridge = fakeBridge({
    listTracks: vi.fn().mockResolvedValue([selected, audition]),
    getTrackSource: vi.fn().mockResolvedValue({ chuckSource: "Math.srandom(__LYRA_SEED__);", sourceSha256: "hash" }),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge, engine) });
  await screen.findByText("captured-ready");

  await act(async () => { await capturedState.selectTrack(selected.id); });
  await act(async () => { await capturedState.previewTrack(audition.id); });
  await act(async () => { await capturedState.stopMusic(); });

  expect(capturedState.selectedTrackId).toBe(selected.id);
  expect(engine.stop).toHaveBeenCalledOnce();
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
    recipeVersion: null,
    recipeJson: null,
    structureFamily: "ambient",
  }));

  (await screen.findByRole("button", { name: "preview-draft" })).click();
  expect(engine.prepareForUserGesture).toHaveBeenCalledOnce();
  expect(prepareValidation).toHaveBeenCalledOnce();
});

test("5秒検証後の再生だけ失敗したDraftは保存可能と明示する", async () => {
  const pending = musicDraft();
  const passed = { ...pending, audioValidation: "passed" as const };
  const engine = new FakeAudioEngine();
  engine.play.mockRejectedValueOnce(new Error("worklet failed"));
  const bridge = fakeBridge({
    generateTrack: vi.fn().mockResolvedValue(pending),
    confirmDraftValidation: vi.fn().mockResolvedValue(passed),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge, engine) });
  await screen.findByText("captured-ready");
  await act(async () => { await capturedState.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }); });

  await expect(capturedState.previewDraft(pending)).rejects.toThrow("曲は保存できます");
  await waitFor(() => expect(capturedState.draft?.audioValidation).toBe("passed"));
});

test("再生中のDraftを破棄すると音声とバックエンドDraftも解放する", async () => {
  const pending = musicDraft();
  const engine = new FakeAudioEngine();
  const discardDraft = vi.fn().mockResolvedValue(undefined);
  const bridge = fakeBridge({ generateTrack: vi.fn().mockResolvedValue(pending), discardDraft });
  render(<CaptureState />, { wrapper: wrapper(bridge, engine) });
  await screen.findByText("captured-ready");
  await act(async () => { await capturedState.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }); });
  act(() => engine.emit({ status: "playing", trackId: pending.id, disabled: false }));

  await act(async () => { await capturedState.discardDraft(); });
  expect(engine.stop).toHaveBeenCalledOnce();
  expect(discardDraft).toHaveBeenCalledWith(pending.id);
  expect(capturedState.draft).toBeNull();
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

test("起動・保存した音量とクロスフェードをDeck再生成なしでAudioEngineへ適用する", async () => {
  const engine = new FakeAudioEngine();
  const initialSettings = { ...DEFAULT_APP_SETTINGS, masterVolume: 0.6, crossfadeSeconds: 4 };
  const savedSettings = { ...initialSettings, masterVolume: 0.4, crossfadeSeconds: 7 };
  const bridge = fakeBridge({
    getSettings: vi.fn().mockResolvedValue(initialSettings),
    saveSettings: vi.fn().mockResolvedValue(savedSettings),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge, engine) });

  await screen.findByText("captured-ready");
  expect(engine.setVolume).toHaveBeenCalledWith(0.6);
  expect(engine.setCrossfadeSeconds).toHaveBeenCalledWith(4);

  await act(async () => { await capturedState.saveSettings(savedSettings); });
  expect(engine.setVolume).toHaveBeenLastCalledWith(0.4);
  expect(engine.setCrossfadeSeconds).toHaveBeenLastCalledWith(7);
  expect(engine.play).not.toHaveBeenCalled();
});

test("再生中の削除だけ音声を止め、どの削除でもタイマーを操作しない", async () => {
  const engine = new FakeAudioEngine();
  engine.state = { status: "playing", trackId: "playing", disabled: false };
  const deleteTracks = vi.fn(async (ids: string[]) => ({ deletedIds: ids, unlinkedChildIds: [] }));
  const timerDispatch = vi.fn();
  const bridge = fakeBridge({ deleteTracks, timerDispatch });
  render(<CaptureState />, { wrapper: wrapper(bridge, engine) });
  await screen.findByText("captured-ready");

  await act(async () => { await capturedState.deleteTracks(["other"]); });
  expect(engine.stop).not.toHaveBeenCalled();

  await act(async () => { await capturedState.deleteTracks(["playing"]); });
  expect(engine.stop).toHaveBeenCalledOnce();
  expect(timerDispatch).not.toHaveBeenCalled();
});

test("ライブラリ試聴では集中用に明示選択した曲を変更しない", async () => {
  const focusTrack = musicTrack("focus", "集中用");
  const audition = musicTrack("audition", "試聴用");
  const bridge = fakeBridge({
    listTracks: vi.fn().mockResolvedValue([focusTrack, audition]),
    getTrackSource: vi.fn().mockResolvedValue({ chuckSource: "SinOsc s => dac;", sourceSha256: "hash" }),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");
  await act(async () => { await capturedState.selectTrack(focusTrack.id); });

  await act(async () => { await capturedState.previewTrack(audition.id); });

  expect(capturedState.selectedTrackId).toBe(focusTrack.id);
});

test("中止後に到着した古い生成Draftを破棄する", async () => {
  const pending = deferred<MusicDraft>();
  let emitProgress: ((progress: MusicGenerationProgress) => void) | undefined;
  const bridge = fakeBridge({
    generateTrack: vi.fn((_request, onProgress) => {
      emitProgress = onProgress;
      return pending.promise;
    }),
    cancelMusicGeneration: vi.fn().mockResolvedValue(undefined),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");

  let generation!: Promise<MusicDraft>;
  const onProgress = vi.fn();
  act(() => { generation = capturedState.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }, onProgress); });
  const rejection = expect(generation).rejects.toThrow("stale music generation result");
  act(() => emitProgress?.({ phase: "composing" }));
  expect(onProgress).toHaveBeenLastCalledWith({ phase: "composing" });
  await act(async () => { await capturedState.cancelMusicGeneration(); });
  act(() => emitProgress?.({ phase: "source_validating" }));
  expect(onProgress).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(musicDraft()); });

  await rejection;
  expect(capturedState.draft).toBeNull();
});

test("集中終了Eventで延期Draftを明示検証できる状態へ戻す", async () => {
  let onTimer: ((state: TimerState) => void) | undefined;
  const bridge = fakeBridge({
    generateTrack: vi.fn().mockResolvedValue(musicDraft({ audioValidation: "deferred_until_focus_ends" })),
    subscribeTimerState: vi.fn(async (listener) => { onTimer = listener; return vi.fn(); }),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");

  await act(async () => { await capturedState.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }); });
  expect(capturedState.draft?.audioValidation).toBe("deferred_until_focus_ends");
  act(() => onTimer?.({ ...initialTimer, status: "paused" }));
  expect(capturedState.draft?.audioValidation).toBe("deferred_until_focus_ends");
  act(() => onTimer?.({ ...initialTimer, status: "completed" }));
  expect(capturedState.draft?.audioValidation).toBe("pending");
});

test("再生中の旧Draftは新しい生成を始める前に停止する", async () => {
  const first = musicDraft({ id: "draft-a" });
  const second = musicDraft({ id: "draft-b" });
  const engine = new FakeAudioEngine();
  const generateTrack = vi.fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const bridge = fakeBridge({ generateTrack });
  render(<CaptureState />, { wrapper: wrapper(bridge, engine) });
  await screen.findByText("captured-ready");
  await act(async () => { await capturedState.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }); });
  act(() => engine.emit({ status: "playing", trackId: first.id, disabled: false }));

  await act(async () => { await capturedState.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }); });

  expect(engine.stop).toHaveBeenCalledOnce();
  expect(capturedState.draft?.id).toBe(second.id);
});

test("再生停止待ちで中止した生成はbridgeへ送信しない", async () => {
  const first = musicDraft({ id: "draft-a" });
  const stop = deferred<void>();
  const engine = new FakeAudioEngine();
  engine.stop.mockImplementationOnce(async () => {
    await stop.promise;
    engine.emit({ status: "stopped", trackId: null, disabled: false });
  });
  const generateTrack = vi.fn().mockResolvedValueOnce(first);
  const bridge = fakeBridge({
    generateTrack,
    cancelMusicGeneration: vi.fn().mockResolvedValue(undefined),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge, engine) });
  await screen.findByText("captured-ready");
  await act(async () => { await capturedState.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }); });
  act(() => engine.emit({ status: "playing", trackId: first.id, disabled: false }));

  let generation!: Promise<MusicDraft>;
  act(() => { generation = capturedState.generateTrack({ version: 1, moods: [{ moodId: "time-midnight", weight: 1 }] }); });
  await waitFor(() => expect(engine.stop).toHaveBeenCalledOnce());
  const rejection = expect(generation).rejects.toThrow("stale music generation result");
  await act(async () => { await capturedState.cancelMusicGeneration(); });
  await act(async () => { stop.resolve(); });

  await rejection;
  expect(generateTrack).toHaveBeenCalledOnce();
  expect(capturedState.draft?.id).toBe(first.id);
  expect(capturedState.musicPlayback).toMatchObject({ status: "stopped", trackId: null });
});

test("再生中のDraftは保存前に停止して孤立音声を残さない", async () => {
  const pending = musicDraft({ audioValidation: "passed" });
  const engine = new FakeAudioEngine();
  const bridge = fakeBridge({
    generateTrack: vi.fn().mockResolvedValue(pending),
    saveDraft: vi.fn().mockResolvedValue(musicTrack("saved", "保存済み")),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge, engine) });
  await screen.findByText("captured-ready");
  await act(async () => { await capturedState.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }); });
  act(() => engine.emit({ status: "playing", trackId: pending.id, disabled: false }));

  await act(async () => { await capturedState.saveDraft(); });

  expect(engine.stop).toHaveBeenCalledOnce();
  expect(capturedState.draft).toBeNull();
});

test("Rust診断とブラウザ所有の音声診断を結合する", async () => {
  const bridge = fakeBridge({ runtimeDiagnostics: vi.fn().mockResolvedValue([
    { component: "sqlite", status: "ok", message: "SQLite ok" },
  ]) });
  const getBrowserDiagnostics = vi.fn().mockResolvedValue([
    { component: "worklet", status: "ok", message: "Worklet ok" },
  ]);
  render(
    <LyraProvider bridge={bridge} audioEngine={new FakeAudioEngine() as unknown as AudioEngine} getBrowserDiagnostics={getBrowserDiagnostics}>
      <CaptureState />
    </LyraProvider>,
  );
  await screen.findByText("captured-ready");

  await expect(capturedState.runtimeDiagnostics()).resolves.toEqual([
    expect.objectContaining({ component: "sqlite" }),
    expect.objectContaining({ component: "worklet" }),
  ]);
});

test("タスク更新が失敗したときローカル状態を変更しない", async () => {
  const original = task("task-1", "変更前");
  const bridge = fakeBridge({
    listTasks: vi.fn().mockResolvedValue([original]),
    updateTask: vi.fn().mockRejectedValue(new Error("write failed")),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");

  await expect(capturedState.updateTask(original.id, { title: "変更後" })).rejects.toThrow("write failed");
  expect(capturedState.tasks[0].title).toBe("変更前");
});

test("遅れて届いた古いライブラリ検索結果を破棄する", async () => {
  const first = deferred<MusicTrack[]>();
  const second = deferred<MusicTrack[]>();
  const listTracks = vi.fn()
    .mockResolvedValueOnce([])
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const bridge = fakeBridge({ listTracks });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");

  let oldQuery!: Promise<void>;
  let newQuery!: Promise<void>;
  act(() => {
    oldQuery = capturedState.setLibraryQuery({ query: "old" });
    newQuery = capturedState.setLibraryQuery({ query: "new" });
  });
  await act(async () => second.resolve([musicTrack("new", "新しい結果")]));
  await newQuery;
  await act(async () => first.resolve([musicTrack("old", "古い結果")]));
  await oldQuery;

  expect(capturedState.libraryTracks.map((track) => track.title)).toEqual(["新しい結果"]);
  expect(capturedState.tracks).toEqual([]);
  expect(capturedState.libraryQuery.query).toBe("new");
});

test("検索中の曲名変更後に古い検索結果を復活させない", async () => {
  const pendingQuery = deferred<MusicTrack[]>();
  const original = musicTrack("track-1", "変更前");
  const renamed = { ...original, title: "変更後" };
  const listTracks = vi.fn().mockResolvedValueOnce([original]).mockImplementationOnce(() => pendingQuery.promise);
  const bridge = fakeBridge({ listTracks, renameTrack: vi.fn().mockResolvedValue(renamed) });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");

  let query!: Promise<void>;
  act(() => { query = capturedState.setLibraryQuery({ query: "変" }); });
  await act(async () => { await capturedState.renameTrack(original.id, renamed.title); });
  await act(async () => pendingQuery.resolve([original]));
  await query;

  expect(capturedState.libraryTracks[0].title).toBe("変更後");
  expect(capturedState.tracks[0].title).toBe("変更後");
});

test("完了済みの選択タスクを集中セッションへ渡さない", async () => {
  const active = { ...task("active", "未完了"), estimatedPomodoros: 2 };
  const completed = { ...task("done", "完了済み"), completed: true, status: "completed" as const, estimatedPomodoros: 9 };
  const bridge = fakeBridge({ listTasks: vi.fn().mockResolvedValue([active, completed]), timerDispatch: vi.fn().mockResolvedValue(initialTimer) });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");
  act(() => { capturedState.selectTask(active.id); capturedState.selectTask(completed.id); });

  expect(capturedState.selectedPomodoroTotal).toBe(2);
  await act(async () => { await capturedState.dispatchTimer({ type: "start", nowMs: 1 }); });
  expect(bridge.startFocus).toHaveBeenCalledWith([active.id], "standard", null);
});

test("BGM開始に失敗しても集中タイマーとDBセッションの開始は成功扱いにする", async () => {
  const track = musicTrack("broken", "壊れた曲");
  const bridge = fakeBridge({
    listTracks: vi.fn().mockResolvedValue([track]),
    timerDispatch: vi.fn().mockResolvedValue({ ...initialTimer, status: "running" }),
    getTrackSource: vi.fn().mockRejectedValue(new Error("source missing")),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");

  await act(async () => { await capturedState.selectTrack(track.id); });
  await act(async () => { await capturedState.dispatchTimer({ type: "start", nowMs: 1 }); });
  expect(bridge.startFocus).toHaveBeenCalledOnce();
  await waitFor(() => expect(capturedState.focusSessionId).toBe("session-1"));
  await waitFor(() => expect(capturedState.musicError).toContain("集中タイマーは継続しています"));
});

test("DBセッション開始に失敗したら開始済みタイマーを終了して元の失敗を返す", async () => {
  const timerDispatch = vi.fn().mockResolvedValue({ ...initialTimer, status: "running" });
  const bridge = fakeBridge({
    timerDispatch,
    startFocus: vi.fn().mockRejectedValue(new Error("sqlite is read only")),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");

  let startError: unknown;
  await act(async () => {
    try { await capturedState.dispatchTimer({ type: "start", nowMs: 1 }); } catch (error) { startError = error; }
  });

  expect(startError).toEqual(expect.objectContaining({ message: "sqlite is read only" }));
  expect(timerDispatch).toHaveBeenNthCalledWith(1, { type: "start", nowMs: 1 }, "standard");
  expect(timerDispatch).toHaveBeenNthCalledWith(2, { type: "end", nowMs: expect.any(Number) }, "standard");
  expect(capturedState.focusSessionId).toBeNull();
});

test("古い集中記録の保存に失敗したら次のタイマーを開始しない", async () => {
  let onTimer: ((state: TimerState) => void) | undefined;
  const timerDispatch = vi.fn().mockResolvedValue({ ...initialTimer, status: "running" });
  const finishFocus = vi.fn().mockRejectedValue(new Error("focus session write failed"));
  const bridge = fakeBridge({
    timerDispatch,
    finishFocus,
    subscribeTimerState: vi.fn(async (listener) => { onTimer = listener; return vi.fn(); }),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");
  await act(async () => { await capturedState.dispatchTimer({ type: "start", nowMs: 1 }); });
  act(() => onTimer?.({ ...initialTimer, status: "completed" }));
  timerDispatch.mockClear();

  let finishError: unknown;
  await act(async () => {
    try { await capturedState.dispatchTimer({ type: "start", nowMs: 2 }); } catch (error) { finishError = error; }
  });

  expect(finishError).toEqual(expect.objectContaining({ message: "focus session write failed" }));
  expect(timerDispatch).not.toHaveBeenCalled();
  expect(bridge.startFocus).toHaveBeenCalledOnce();
});

test("休憩中のStartはタイマーにもDBセッションにも到達しない", async () => {
  const timerDispatch = vi.fn();
  const startFocus = vi.fn();
  const bridge = fakeBridge({
    getTimerState: vi.fn().mockResolvedValue({ ...initialTimer, phase: "short_break", status: "running" }),
    timerDispatch,
    startFocus,
  });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");

  let startError: unknown;
  await act(async () => {
    try { await capturedState.dispatchTimer({ type: "start", nowMs: 1 }); } catch (error) { startError = error; }
  });

  expect(startError).toEqual(expect.objectContaining({ message: "休憩を終了してから次の集中を始めてください" }));
  expect(timerDispatch).not.toHaveBeenCalled();
  expect(startFocus).not.toHaveBeenCalled();
});

test("無音で集中を始めると直前の試聴音声を停止する", async () => {
  const engine = new FakeAudioEngine();
  engine.state = { status: "playing", trackId: "audition", disabled: false };
  const bridge = fakeBridge({ timerDispatch: vi.fn().mockResolvedValue({ ...initialTimer, status: "running" }) });
  render(<CaptureState />, { wrapper: wrapper(bridge, engine) });
  await screen.findByText("captured-ready");

  await act(async () => { await capturedState.dispatchTimer({ type: "start", nowMs: 1 }); });

  expect(engine.stop).toHaveBeenCalledOnce();
  expect(bridge.startFocus).toHaveBeenCalledOnce();
});

test("自動休憩中の終了は満額の集中時間を記録し次の開始で古いセッションを再利用しない", async () => {
  let onTimer: ((state: TimerState) => void) | undefined;
  const startFocus = vi.fn()
    .mockResolvedValueOnce({ id: "session-1" })
    .mockResolvedValueOnce({ id: "session-2" })
    .mockResolvedValueOnce({ id: "session-3" });
  const bridge = fakeBridge({
    timerDispatch: vi.fn().mockResolvedValue(initialTimer),
    startFocus,
    subscribeTimerState: vi.fn(async (listener) => { onTimer = listener; return vi.fn(); }),
  });
  render(<CaptureState />, { wrapper: wrapper(bridge) });
  await screen.findByText("captured-ready");

  await act(async () => { await capturedState.dispatchTimer({ type: "start", nowMs: 1 }); });
  act(() => onTimer?.({ ...initialTimer, phase: "short_break", status: "running", remainingSeconds: 300 }));
  const dispatchesBeforeRecording = vi.mocked(bridge.timerDispatch).mock.calls.length;
  await act(async () => { await capturedState.endFocus([]); });
  expect(bridge.finishFocus).toHaveBeenCalledWith("session-1", 1_500, []);
  expect(bridge.timerDispatch).toHaveBeenCalledTimes(dispatchesBeforeRecording);
  expect(capturedState.timer.phase).toBe("short_break");
  expect(capturedState.timer.status).toBe("running");

  act(() => onTimer?.({ ...initialTimer, status: "completed" }));
  await act(async () => { await capturedState.dispatchTimer({ type: "start", nowMs: 2_000 }); });
  expect(startFocus).toHaveBeenCalledTimes(2);
  expect(capturedState.focusSessionId).toBe("session-2");

  act(() => onTimer?.({ ...initialTimer, phase: "short_break", status: "running", remainingSeconds: 300 }));
  act(() => onTimer?.({ ...initialTimer, status: "completed" }));
  await act(async () => { await capturedState.dispatchTimer({ type: "start", nowMs: 3_000 }); });
  expect(bridge.finishFocus).toHaveBeenLastCalledWith("session-2", 1_500, []);
  expect(startFocus).toHaveBeenCalledTimes(3);
  expect(capturedState.focusSessionId).toBe("session-3");
});
