// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

afterEach(cleanup);

const context = vi.hoisted(() => ({ stopMusic: vi.fn() }));

vi.mock("./screens/FocusScreen", () => ({ FocusScreen: () => <h1>集中画面</h1> }));
vi.mock("./screens/TasksScreen", () => ({ TasksScreen: () => <h1>タスク画面</h1> }));
vi.mock("./screens/StudioScreen", () => ({ StudioScreen: () => <h1>BGM制作画面</h1> }));
vi.mock("./screens/LibraryScreen", () => ({ LibraryScreen: () => <h1>ライブラリ画面</h1> }));
vi.mock("./screens/SettingsScreen", () => ({ SettingsScreen: () => <h1>設定画面</h1> }));
vi.mock("./state/LyraContext", () => ({ useLyra: () => context }));

import { App } from "./App";

test("固定サイドバーから5画面を切り替えられる", async () => {
  const user = userEvent.setup();
  render(<App />);

  expect(screen.getByRole("heading", { name: "集中画面" })).toBeInTheDocument();
  const destinations = [
    ["タスク", "タスク画面"],
    ["BGM制作", "BGM制作画面"],
    ["ライブラリ", "ライブラリ画面"],
    ["設定", "設定画面"],
    ["集中", "集中画面"]
  ] as const;

  for (const [label, heading] of destinations) {
    await user.click(screen.getByRole("button", { name: label }));
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  }
});

test("どの画面からでも音楽を停止できる", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: "音楽停止" }));

  expect(context.stopMusic).toHaveBeenCalledOnce();
});
