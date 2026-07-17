// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

afterEach(cleanup);

const context = vi.hoisted(() => ({
  stopMusic: vi.fn(),
  retryStartup: vi.fn(),
  retrySubscriptions: vi.fn(),
  ready: true,
  startupError: null as string | null,
  subscriptionError: null as string | null,
  musicError: null as string | null,
  musicGeneration: {
    phase: "idle",
    cancelling: false,
    sessionId: 0,
  },
}));
const sonner = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("./screens/FocusScreen", () => ({ FocusScreen: () => <h1>集中画面</h1> }));
vi.mock("./screens/TasksScreen", () => ({ TasksScreen: () => <h1>タスク画面</h1> }));
vi.mock("./screens/StudioScreen", () => ({ StudioScreen: () => <h1>BGM制作画面</h1> }));
vi.mock("./screens/LibraryScreen", () => ({ LibraryScreen: () => <h1>ライブラリ画面</h1> }));
vi.mock("./screens/SettingsScreen", () => ({ SettingsScreen: () => <h1>設定画面</h1> }));
vi.mock("./state/LyraContext", () => ({ useLyra: () => context }));
vi.mock("sonner", () => ({ toast: sonner, Toaster: () => null }));

import { App, AppGate } from "./App";

beforeEach(() => {
  context.musicGeneration = { phase: "idle", cancelling: false, sessionId: 0 };
  sonner.success.mockReset();
  sonner.error.mockReset();
});

test("固定サイドバーから5画面を切り替えられる", async () => {
  const user = userEvent.setup();
  render(<App />);

  expect(screen.getByRole("heading", { name: "集中画面" })).toBeInTheDocument();
  const destinations = [
    ["タスク", "タスク画面"],
    ["Music Alchemy", "BGM制作画面"],
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

  await user.click(screen.getByRole("button", { name: "音楽を停止" }));

  expect(context.stopMusic).toHaveBeenCalledOnce();
});

test("別画面で生成が完了したら一度だけ通知し、通知からMusic Alchemyへ戻れる", async () => {
  const user = userEvent.setup();
  const view = render(<App />);
  await user.click(screen.getByRole("button", { name: "タスク" }));

  context.musicGeneration = { phase: "ready", cancelling: false, sessionId: 1 };
  view.rerender(<App />);

  expect(sonner.success).toHaveBeenCalledOnce();
  expect(sonner.success).toHaveBeenCalledWith("音楽が完成しました", expect.objectContaining({ action: expect.any(Object) }));
  const options = sonner.success.mock.calls[0][1] as { action: { onClick: () => void } };
  act(() => options.action.onClick());
  expect(screen.getByRole("heading", { name: "BGM制作画面" })).toBeInTheDocument();

  view.rerender(<App />);
  expect(sonner.success).toHaveBeenCalledOnce();
});

test("Event購読失敗を起動済み画面と分けて表示し再接続できる", async () => {
  const user = userEvent.setup();
  context.subscriptionError = "event listener unavailable";

  render(<AppGate />);

  expect(screen.getByRole("heading", { name: "集中画面" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("event listener unavailable");
  await user.click(screen.getByRole("button", { name: "再接続" }));
  expect(context.retrySubscriptions).toHaveBeenCalledOnce();
  expect(context.retryStartup).not.toHaveBeenCalled();
  context.subscriptionError = null;
});
