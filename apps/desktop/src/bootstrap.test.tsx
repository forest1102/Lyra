// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/dom";
import { afterEach, describe, expect, test } from "vitest";
import { bootstrapLyra } from "./bootstrap";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  document.body.innerHTML = "";
});

function rootElement() {
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  return root;
}

describe("Lyra bootstrap", () => {
  test("browser developmentではTauri APIなしで起動データを表示する", async () => {
    unmount = await bootstrapLyra(rootElement(), "browser-development");

    expect(await screen.findByRole("navigation", { name: "メインナビゲーション" })).toBeInTheDocument();
    expect(screen.queryByText("Lyraを起動できませんでした")).not.toBeInTheDocument();
  });

  test("production bundleをTauri外で開いた場合はdesktop appからの起動を案内する", async () => {
    unmount = await bootstrapLyra(rootElement(), "unsupported-browser");

    expect(await screen.findByRole("alert")).toHaveTextContent("デスクトップアプリから起動してください");
    expect(screen.queryByText("transformCallback")).not.toBeInTheDocument();
  });
});
