import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createBrowserDevBridge } from "./browserDev";

afterEach(() => vi.useRealTimers());

describe("BrowserDevBridge", () => {
  test("ブラウザだけで起動データと安全な固定ChucK曲を提供する", async () => {
    const bridge = createBrowserDevBridge();

    const [tasks, tracks, presets, timer] = await Promise.all([
      bridge.listTasks(),
      bridge.listTracks(),
      bridge.listTimerPresets(),
      bridge.getTimerState(),
    ]);

    expect(tasks.length).toBeGreaterThan(0);
    expect(presets.some((preset) => preset.id === "standard")).toBe(true);
    expect(timer.preset.id).toBe("standard");
    expect(tracks.length).toBeGreaterThan(0);
    const source = await bridge.getTrackSource(tracks[0].id);
    expect(source.chuckSource).toContain("__LYRA_SEED__");
    expect(source.sourceSha256).toBe(tracks[0].sourceSha256);
    expect(createHash("sha256").update(source.chuckSource).digest("hex")).toBe(source.sourceSha256);
  });

  test("変更をインメモリに保持し、購読解除後はTimer通知を止める", async () => {
    const bridge = createBrowserDevBridge();
    const onTimer = vi.fn();
    const unsubscribe = await bridge.subscribeTimerState(onTimer);

    const added = await bridge.addTask("ブラウザで追加", "today", 2);
    await bridge.setTaskCompleted(added.id, true);
    expect((await bridge.listTasks()).find((task) => task.id === added.id)).toMatchObject({ completed: true });

    await bridge.timerDispatch({ type: "start", nowMs: 1_000 }, "standard");
    expect(onTimer).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));

    unsubscribe();
    onTimer.mockClear();
    await bridge.timerDispatch({ type: "pause", nowMs: 2_000 }, "standard");
    expect(onTimer).not.toHaveBeenCalled();
  });

  test("running中は実時間に合わせて残り時間を購読者へ通知する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const bridge = createBrowserDevBridge();
    const onTimer = vi.fn();
    await bridge.subscribeTimerState(onTimer);

    await bridge.timerDispatch({ type: "start", nowMs: Date.now() }, "standard");
    onTimer.mockClear();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onTimer).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "running",
      remainingSeconds: 1_499,
    }));
  });

  test("集中完了を通知し、最後の購読解除でtick intervalを解放する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const bridge = createBrowserDevBridge();
    await bridge.saveTimerPreset({
      id: "instant",
      name: "Instant",
      focusMinutes: 0,
      shortBreakMinutes: 1,
      longBreakMinutes: 1,
      cyclesBeforeLongBreak: 4,
      builtIn: false,
    });
    const onTimer = vi.fn();
    const unsubscribe = await bridge.subscribeTimerState(onTimer);
    await bridge.timerDispatch({ type: "select_preset" }, "instant");
    await bridge.timerDispatch({ type: "start", nowMs: Date.now() }, "instant");

    await vi.advanceTimersByTimeAsync(250);
    expect(onTimer).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "awaiting_break",
      completedFocusCycles: 1,
    }));

    unsubscribe();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  test("拡張タスク・ライブラリ・設定のDesktopBridge契約をインメモリで満たす", async () => {
    const bridge = createBrowserDevBridge();
    const [project] = await bridge.listProjects();
    const [tag] = await bridge.listTags();
    const added = await bridge.addTaskV2({
      title: "新しい作業",
      status: "active",
      projectId: project.id,
      tagIds: [tag.id],
    });
    const updated = await bridge.updateTask(added.id, { priority: "high", notes: "詳細" });
    await bridge.reorderTasks([added.id], "active");

    expect(updated).toMatchObject({ priority: "high", notes: "詳細", projectId: project.id });
    expect(updated.tags).toEqual([tag]);

    const [track] = await bridge.listTracks();
    const renamed = await bridge.renameTrack(track.id, "  新しい曲名  ");
    expect(renamed.title).toBe("新しい曲名");
    await expect(bridge.listTracks({ query: "新しい曲名", sort: "title_asc" })).resolves.toHaveLength(1);
    await expect(bridge.deleteTracks([track.id, track.id])).resolves.toMatchObject({ deletedIds: [track.id] });

    const settings = await bridge.saveSettings({ ...await bridge.getSettings(), masterVolume: 0.5, crossfadeSeconds: 6 });
    expect(settings).toMatchObject({ masterVolume: 0.5, crossfadeSeconds: 6 });
    await expect(bridge.runtimeDiagnostics()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ component: "sqlite" }),
      expect.objectContaining({ component: "codex" }),
    ]));
    await expect(bridge.openDataDirectory()).resolves.toBeUndefined();
  });

  test("空IDで作る複数のProjectとTagへ別々の開発IDを割り当てる", async () => {
    const bridge = createBrowserDevBridge();
    const firstProject = await bridge.saveProject({ id: "", name: "One", color: null, position: 0 });
    const secondProject = await bridge.saveProject({ id: "", name: "Two", color: null, position: 1 });
    const firstTag = await bridge.saveTag({ id: "", name: "A" });
    const secondTag = await bridge.saveTag({ id: "", name: "B" });

    expect(firstProject.id).not.toBe("");
    expect(secondProject.id).not.toBe(firstProject.id);
    expect(secondTag.id).not.toBe(firstTag.id);
    expect((await bridge.listProjects()).filter((project) => [firstProject.id, secondProject.id].includes(project.id))).toHaveLength(2);
    expect((await bridge.listTags()).filter((tag) => [firstTag.id, secondTag.id].includes(tag.id))).toHaveLength(2);
  });

  test("生成中止後に固定Draftを到着させない", async () => {
    const bridge = createBrowserDevBridge();
    const pending = bridge.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] });
    await bridge.cancelMusicGeneration();
    await expect(pending).rejects.toThrow("cancelled");
  });

  test("固定Draft生成でも実処理と同じ生成境界を順に通知する", async () => {
    const bridge = createBrowserDevBridge();
    const phases: string[] = [];

    await bridge.generateTrack(
      { version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] },
      ({ phase }) => phases.push(phase),
    );

    expect(phases).toEqual(["started", "composing", "source_validating"]);
  });

  test("自動休憩設定では集中完了後に短い休憩を開始する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const bridge = createBrowserDevBridge();
    await bridge.saveSettings({ ...await bridge.getSettings(), autoStartBreak: true });
    await bridge.saveTimerPreset({
      id: "instant-auto-break",
      name: "Instant",
      focusMinutes: 0,
      shortBreakMinutes: 1,
      longBreakMinutes: 2,
      cyclesBeforeLongBreak: 4,
      builtIn: false,
    });
    const listener = vi.fn();
    const unsubscribe = await bridge.subscribeTimerState(listener);
    await bridge.timerDispatch({ type: "select_preset" }, "instant-auto-break");
    await bridge.timerDispatch({ type: "start", nowMs: Date.now() }, "instant-auto-break");

    await vi.advanceTimersByTimeAsync(250);

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: "short_break",
      status: "running",
      remainingSeconds: 60,
    }));
    unsubscribe();
  });

  test("繰り返し完了時に次回分を作り予定日と期限の幅を保つ", async () => {
    const bridge = createBrowserDevBridge();
    const recurring = await bridge.addTaskV2({
      title: "週次レビュー",
      status: "active",
      plannedDate: "2026-07-15",
      dueDate: "2026-07-17",
      recurrence: "weekly",
    });

    await bridge.setTaskCompleted(recurring.id, true);

    const occurrences = (await bridge.listTasks()).filter((task) => task.title === recurring.title);
    expect(occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: recurring.id, status: "completed" }),
      expect.objectContaining({ status: "active", plannedDate: "2026-07-22", dueDate: "2026-07-24" }),
    ]));
  });

  test("一時停止中の集中でも音声検証を延期し新しいDraftで古いDraftを破棄する", async () => {
    const bridge = createBrowserDevBridge();
    await bridge.timerDispatch({ type: "start", nowMs: 1_000 }, "standard");
    await bridge.timerDispatch({ type: "pause", nowMs: 2_000 }, "standard");
    const first = await bridge.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] });
    const second = await bridge.generateTrack({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] });

    expect(first.audioValidation).toBe("deferred_until_focus_ends");
    expect(second.audioValidation).toBe("deferred_until_focus_ends");
    await expect(bridge.confirmDraftValidation(first.id, {
      durationMs: 5_000,
      elapsedAudioSeconds: 5,
      peak: 0.5,
      nonSilentMs: 500,
      nonFiniteSamples: 0,
      processorErrors: 0,
    })).rejects.toThrow("not found");
  });

  test("同じIDのプリセット編集を次回開始へ反映し選択中の削除を拒否する", async () => {
    const bridge = createBrowserDevBridge();
    const custom = await bridge.saveTimerPreset({
      id: "custom",
      name: "Custom",
      focusMinutes: 30,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      cyclesBeforeLongBreak: 4,
      builtIn: false,
    });
    await bridge.timerDispatch({ type: "select_preset" }, custom.id);
    await bridge.saveTimerPreset({ ...custom, name: "Custom 40", focusMinutes: 40 });

    const running = await bridge.timerDispatch({ type: "start", nowMs: 1_000 }, custom.id);

    expect(running.preset).toMatchObject({ id: custom.id, name: "Custom 40", focusMinutes: 40 });
    expect(running.remainingSeconds).toBe(2_400);
    await expect(bridge.deleteTimerPreset(custom.id)).rejects.toThrow("active timer preset");
  });
});
