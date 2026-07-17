import { $, expect } from "@wdio/globals";

export async function waitForAppReady(): Promise<void> {
  await $("button=集中").click();
  await expect($("h1=集中")).toBeDisplayed();
}

export async function openScreen(label: string): Promise<void> {
  await $(`button=${label}`).click();
  const selector = {
    "集中": ".focus-screen",
    "タスク": ".tasks-screen",
    "Music Alchemy": ".alchemy-screen",
    "ライブラリ": ".library-screen",
    "設定": ".settings-screen",
  }[label] ?? `h1=${label}`;
  await expect($(selector)).toBeDisplayed();
}

export function taskRow(title: string) {
  return $(`//article[contains(@class, 'task-row-shell')][.//strong[normalize-space()=${JSON.stringify(title)}]]`);
}
