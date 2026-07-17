import { strict as assert } from "node:assert";
import { $, browser, expect } from "@wdio/globals";
import { openScreen, waitForAppReady } from "../support/app";

describe("モックIPC", () => {
  beforeEach(async () => {
    await waitForAppReady();
  });

  it("サイドバーから5画面を巡回できる", async () => {
    for (const label of ["集中", "タスク", "Music Alchemy", "ライブラリ", "設定"]) {
      await openScreen(label);
    }
  });

  it("add_taskとlist_tasksの結果と引数を画面から確認できる", async () => {
    const task = {
      id: "mock-task",
      title: "モックIPCを確認する",
      list: "today",
      completed: false,
      estimatedPomodoros: 2,
      status: "inbox",
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
      createdAt: "2026-07-15T00:00:00Z",
      updatedAt: "2026-07-15T00:00:00Z"
    };
    const listTasks = await browser.tauri.mock("list_tasks");
    const addTask = await browser.tauri.mock("add_task_v2");
    await listTasks.mockResolvedValue([]);
    await addTask.mockResolvedValue(task);

    await openScreen("タスク");
    await listTasks.mockResolvedValue([task]);
    await $("input[placeholder='タスクを追加…']").setValue(task.title);
    await $("input[placeholder='🍅']").setValue("2");
    await $("button=追加").click();

    await expect($(`strong=${task.title}`)).toBeDisplayed();
    await browser.waitUntil(async () => {
      await addTask.update();
      return addTask.mock.calls.length === 1;
    }, { timeout: 5_000, timeoutMsg: "add_task_v2 mock did not receive the form submission" });
    assert.deepEqual(addTask.mock.calls[0], [{ input: {
      title: task.title,
      status: "inbox",
      priority: "none",
      estimatedPomodoros: 2,
      projectId: null,
      plannedDate: null,
      dueDate: null,
      recurrence: null,
      tagIds: []
    } }]);
  });

  it("オーディオ設定を明示保存しsave_app_settingsの引数を確認できる", async () => {
    const savedSettings = {
      version: 2,
      closeBehavior: "hide",
      launchAtLogin: false,
      defaultPresetId: "standard",
      autoStartBreak: false,
      notificationsEnabled: true,
      masterVolume: 1.65,
      playSelectedTrackOnFocus: true,
      crossfadeSeconds: 4
    };
    const saveSettings = await browser.tauri.mock("save_app_settings");
    await saveSettings.mockResolvedValue(savedSettings);

    await openScreen("設定");
    await $("button=オーディオ").click();
    await $("input[aria-label='マスター音量']").setValue("165");
    await $("input[aria-label='クロスフェード']").setValue("4");
    await $("button=設定を保存").click();
    await browser.waitUntil(async () => {
      await saveSettings.update();
      return saveSettings.mock.calls.length === 1;
    }, { timeout: 5_000, timeoutMsg: "save_app_settings mock did not receive the form submission" });
    assert.deepEqual(saveSettings.mock.calls[0], [{ settings: savedSettings }]);
  });

  it("生成後の明示クリックでWebChucKを無音検証して再生状態へ遷移する", async () => {
    const draft = {
      id: "e2e-audio-draft",
      parentTrackId: null,
      title: "E2E WebChucK",
      description: "実WKWebViewの音声起動を検証する",
      theme: "deep-space",
      arrangement: "ambient",
      brightness: "medium",
      density: "medium",
      motion: "low",
      bpm: 64,
      tailSeconds: 0,
      chuckSource: "Math.srandom(__LYRA_SEED__); SinOsc oscillator => Gain master => dac; 440 => oscillator.freq; 0.1 => master.gain; while (true) { 500::ms => now; }",
      sourceSha256: "e2e",
      canonicalSeed: 42,
      audioValidation: "pending",
      recipeVersion: 1,
      recipeJson: JSON.stringify({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }),
      structureFamily: "ambient"
    };
    const generateMusic = await browser.tauri.mock("generate_music");
    const confirmValidation = await browser.tauri.mock("confirm_music_draft_validation");
    await generateMusic.mockResolvedValue(draft);
    await confirmValidation.mockResolvedValue({ ...draft, audioValidation: "passed" });

    await openScreen("Music Alchemy");
    await $("button=このムードで生成").click();
    await expect($("h2=E2E WebChucK")).toBeDisplayed();
    await $("button=検証して再生").click();

    await expect($("button=停止")).toBeDisplayed();
  });

  it("ライブコーディング中の生成を画面から中止できる", async () => {
    const generateMusic = await browser.tauri.mock("generate_music");
    const cancelGeneration = await browser.tauri.mock("cancel_music_generation");
    await generateMusic.mockImplementation((args?: unknown) => {
      const input = args as { onProgress?: { onmessage?: (progress: unknown) => void } } | undefined;
      input?.onProgress?.onmessage?.({ phase: "composing" });
      return new Promise<void>(() => undefined);
    });
    await cancelGeneration.mockResolvedValue(null);

    await openScreen("Music Alchemy");
    await $("button=このムードで生成").click();
    await expect($("button=生成を中止")).toBeDisplayed();
    await $("button=生成を中止").click();
    await expect($("button=このムードで生成")).toBeDisplayed();
    await browser.waitUntil(async () => {
      await cancelGeneration.update();
      return cancelGeneration.mock.calls.length === 1;
    }, { timeout: 5_000, timeoutMsg: "cancel_music_generation was not called" });
  });

});
