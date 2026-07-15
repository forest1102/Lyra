import { strict as assert } from "node:assert";
import { $, browser, expect } from "@wdio/globals";
import { openScreen, waitForAppReady } from "../support/app";

describe("モックIPC", () => {
  beforeEach(async () => {
    await waitForAppReady();
  });

  it("サイドバーから5画面を巡回できる", async () => {
    for (const label of ["集中", "タスク", "BGM制作", "ライブラリ", "設定"]) {
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
      createdAt: "2026-07-15T00:00:00Z",
      updatedAt: "2026-07-15T00:00:00Z"
    };
    const listTasks = await browser.tauri.mock("list_tasks");
    const addTask = await browser.tauri.mock("add_task");
    await listTasks.mockResolvedValue([]);
    await addTask.mockResolvedValue(task);

    await openScreen("タスク");
    await expect($("h2=ここは空です")).toBeDisplayed();
    await listTasks.mockResolvedValue([task]);
    await $("input[placeholder='次に進めるタスク']").setValue(task.title);
    await $("input[placeholder='🍅']").setValue("2");
    await $("button=追加").click();

    await expect($(`strong=${task.title}`)).toBeDisplayed();
    await browser.waitUntil(async () => {
      await addTask.update();
      return addTask.mock.calls.length === 1;
    }, { timeout: 5_000, timeoutMsg: "add_task mock did not receive the form submission" });
    assert.deepEqual(addTask.mock.calls[0], [{ input: { title: task.title, list: "today", estimatedPomodoros: 2 } }]);
  });

  it("save_timer_presetのフォーム値と引数を確認できる", async () => {
    const savedPreset = {
      id: "mock-preset",
      name: "E2E集中",
      focusMinutes: 35,
      shortBreakMinutes: 7,
      longBreakMinutes: 21,
      cyclesBeforeLongBreak: 3,
      builtIn: false
    };
    const savePreset = await browser.tauri.mock("save_timer_preset");
    await savePreset.mockResolvedValue(savedPreset);

    await openScreen("設定");
    await $("input[placeholder='名前']").setValue(savedPreset.name);
    await $("//label[.//span[normalize-space()='集中']]//input").setValue("35");
    await $("//label[.//span[normalize-space()='短い休憩']]//input").setValue("7");
    await $("//label[.//span[normalize-space()='長い休憩']]//input").setValue("21");
    await $("//label[.//span[normalize-space()='サイクル']]//input").setValue("3");
    await $("button=保存").click();

    await expect($("p*=E2E集中 35/7")).toBeDisplayed();
    await browser.waitUntil(async () => {
      await savePreset.update();
      return savePreset.mock.calls.length === 1;
    }, { timeout: 5_000, timeoutMsg: "save_timer_preset mock did not receive the form submission" });
    const call = savePreset.mock.calls[0]?.[0] as { preset?: Record<string, unknown> } | undefined;
    assert.deepEqual(call?.preset, {
      ...savedPreset,
      id: call?.preset?.id
    });
    assert.match(String(call?.preset?.id), /^[0-9a-f-]{36}$/i);
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
      audioValidation: "pending"
    };
    const generateMusic = await browser.tauri.mock("generate_music");
    const confirmValidation = await browser.tauri.mock("confirm_music_draft_validation");
    await generateMusic.mockResolvedValue(draft);
    await confirmValidation.mockResolvedValue({ ...draft, audioValidation: "passed" });

    await openScreen("BGM制作");
    await $("button=生成する").click();
    await expect($("h2=E2E WebChucK")).toBeDisplayed();
    await $("button=検証して再生").click();

    await expect($("button=■ 停止")).toBeDisplayed();
  });

  it("ライブコーディング中の生成を画面から中止できる", async () => {
    const generateMusic = await browser.tauri.mock("generate_music");
    const cancelGeneration = await browser.tauri.mock("cancel_music_generation");
    await generateMusic.mockImplementation((args?: unknown) => {
      const input = args as { onProgress?: { onmessage?: (progress: unknown) => void } } | undefined;
      input?.onProgress?.onmessage?.({ phase: "coding" });
      return new Promise<void>(() => undefined);
    });
    await cancelGeneration.mockResolvedValue(null);

    await openScreen("BGM制作");
    await $("button=生成する").click();
    await expect($("button=生成を中止")).toBeDisplayed();
    await $("button=生成を中止").click();
    await expect($("button=生成する")).toBeDisplayed();
    await browser.waitUntil(async () => {
      await cancelGeneration.update();
      return cancelGeneration.mock.calls.length === 1;
    }, { timeout: 5_000, timeoutMsg: "cancel_music_generation was not called" });
  });

});
