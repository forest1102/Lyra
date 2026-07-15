import { $, expect } from "@wdio/globals";

export async function waitForAppReady(): Promise<void> {
  await $("button=集中").click();
  await expect($("h1=集中")).toBeDisplayed();
}

export async function openScreen(label: string): Promise<void> {
  await $(`button=${label}`).click();
  await expect($(`h1=${label}`)).toBeDisplayed();
}

export function backlogButton() {
  return $("//button[starts-with(normalize-space(.), 'あとで ')]");
}

export function taskRow(title: string) {
  return $(`//div[contains(@class, 'task-row')][.//strong[normalize-space()=${JSON.stringify(title)}]]`);
}
