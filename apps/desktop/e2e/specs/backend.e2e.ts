import { $, browser, expect } from "@wdio/globals";
import { backlogButton, openScreen, taskRow, waitForAppReady } from "../support/app";

async function addTask(title: string, estimate = "1"): Promise<void> {
  await openScreen("タスク");
  await $("input[placeholder='次に進めるタスク']").setValue(title);
  await $("input[placeholder='🍅']").setValue(estimate);
  await $("button=追加").click();
  await expect($(`strong=${title}`)).toBeDisplayed();
}

describe("実バックエンド", () => {
  beforeEach(async () => {
    await waitForAppReady();
  });

  it("タスクの追加・移動・完了を再読込後もSQLiteに保持する", async () => {
    const title = "永続化するE2Eタスク";
    await addTask(title, "2");
    await (await taskRow(title)).$("button=→ あとで").click();
    await backlogButton().click();
    await (await taskRow(title)).$(`button[aria-label='${title}を完了にする']`).click();

    await browser.refresh();
    await waitForAppReady();
    await openScreen("タスク");
    await backlogButton().click();
    await expect((await taskRow(title)).$(`button[aria-label='${title}を未完了にする']`)).toBeDisplayed();
  });

  it("無音の集中を一時停止・再開し、終了記録でタスクを完了できる", async () => {
    const title = "集中フローを完了する";
    await addTask(title);
    await openScreen("集中");
    await $(`button=${title}`).click();
    await $("button=集中を始める").click();
    await expect($("button=一時停止")).toBeDisplayed();
    await $("button=一時停止").click();
    await expect($("button=再開")).toBeDisplayed();
    await $("button=再開").click();
    await expect($("button=一時停止")).toBeDisplayed();
    await $("button=終了").click();
    await expect($("h2=今回完了したタスク")).toBeDisplayed();
    await $("section.complete-card").$(`button*=${title}`).click();
    await $("button=記録して終了").click();
    await expect($("button=集中を始める")).toBeDisplayed();

    await openScreen("タスク");
    await expect($(`button[aria-label='${title}を未完了にする']`)).toBeDisplayed();
  });
});
