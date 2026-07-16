// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const context = vi.hoisted(() => ({
  tasks: [{
    id: "task-1", title: "企画をまとめる", list: "today", completed: false,
    estimatedPomodoros: 2, status: "active", priority: "high", projectId: null,
    parentId: null, notes: "", plannedDate: "2026-07-15", dueDate: null,
    position: 0, completedAt: null, recurrence: null, tags: [],
    createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z",
  }],
  tracks: [],
  selectedTrackId: null,
  variationSeed: null,
  selectedTaskIds: ["task-1"],
  selectedPomodoroTotal: 2,
  focusSessionId: "session-1" as string | null,
  timer: {
    preset: { id: "standard", name: "Standard", focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLongBreak: 4, builtIn: true },
    phase: "focus", status: "running", remainingSeconds: 1_440, completedFocusCycles: 0, deadlineMs: Date.now() + 1_440_000,
  },
  preset: { id: "standard", name: "Standard", focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLongBreak: 4, builtIn: true },
  presets: [],
  musicError: "WebChucKが2回停止したため、この集中セッションのBGMを無効にしました",
  musicPlayback: { status: "stopped", trackId: null, disabled: true },
  dispatchTimer: vi.fn(), selectTask: vi.fn(), selectPreset: vi.fn(), selectTrack: vi.fn(), endFocus: vi.fn(),
}));

vi.mock("../state/LyraContext", () => ({ useLyra: () => context }));

import { FocusScreen } from "./FocusScreen";

const defaultTask = { ...context.tasks[0] };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  context.focusSessionId = "session-1";
  context.selectedTaskIds = ["task-1"];
  context.timer = { ...context.timer, phase: "focus", status: "running", remainingSeconds: 1_440 };
  context.tasks = [{ ...defaultTask }];
});

test("横長プログレスと選択タスクを表示する", () => {
  render(<FocusScreen />);

  expect(screen.getByText("24:00")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
  expect(screen.getByText("企画をまとめる")).toBeInTheDocument();
  expect(screen.getAllByText(/2 Pomodoro/).length).toBeGreaterThan(0);
  expect(document.querySelector("svg circle")).not.toBeInTheDocument();
});

test("BGM障害時も集中タイマーを維持し再開方法を表示する", () => {
  render(<FocusScreen />);

  expect(screen.getByText("24:00")).toBeInTheDocument();
  expect(screen.getByText(/集中セッションはそのまま継続/)).toBeInTheDocument();
  expect(screen.getByText(/設定.*ランタイム/)).toBeInTheDocument();
  expect(context.dispatchTimer).not.toHaveBeenCalled();
});

test("集中記録済みの休憩は完了Dialogを経由せず終了できる", () => {
  context.dispatchTimer.mockResolvedValue(undefined);
  context.focusSessionId = null;
  context.timer = { ...context.timer, phase: "short_break", status: "running", remainingSeconds: 240 };
  render(<FocusScreen />);

  fireEvent.click(screen.getByRole("button", { name: "休憩を終了" }));
  expect(context.dispatchTimer).toHaveBeenCalledWith({ type: "end", nowMs: expect.any(Number) });
});

test("未記録の休憩終了は記録とタイマー終了を一度の操作で完了する", async () => {
  context.endFocus.mockResolvedValue(undefined);
  context.dispatchTimer.mockResolvedValue(undefined);
  context.timer = { ...context.timer, phase: "short_break", status: "running", remainingSeconds: 240 };
  render(<FocusScreen />);

  fireEvent.click(screen.getByRole("button", { name: "戻る" }));
  fireEvent.click(screen.getByRole("button", { name: "休憩を終了" }));
  fireEvent.click(screen.getByRole("button", { name: "記録して終了" }));

  await waitFor(() => expect(context.endFocus).toHaveBeenCalledWith([]));
  expect(context.dispatchTimer).toHaveBeenCalledWith({ type: "end", nowMs: expect.any(Number) });
});

test("前の集中で選んだ完了タスクを次の集中記録へ持ち越さない", async () => {
  context.endFocus.mockResolvedValue(undefined);
  context.timer = { ...context.timer, phase: "short_break", status: "running", remainingSeconds: 240 };
  const view = render(<FocusScreen />);

  fireEvent.click(screen.getByRole("checkbox", { name: "企画をまとめる" }));
  fireEvent.click(screen.getByRole("button", { name: "記録して終了" }));
  await waitFor(() => expect(context.endFocus).toHaveBeenLastCalledWith(["task-1"]));

  context.focusSessionId = "session-2";
  context.tasks = [{ ...defaultTask, id: "task-2", title: "次の作業" }];
  context.selectedTaskIds = ["task-2"];
  view.rerender(<FocusScreen />);
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "次の作業" })).not.toBeChecked());
  fireEvent.click(screen.getByRole("button", { name: "記録して終了" }));

  await waitFor(() => expect(context.endFocus).toHaveBeenLastCalledWith([]));
  context.selectedTaskIds = ["task-1"];
});

test("完了済みの選択タスクは今回の集中から除外する", () => {
  context.tasks = [{ ...context.tasks[0], completed: true, status: "completed" }];
  render(<FocusScreen />);

  expect(screen.queryByText("企画をまとめる")).not.toBeInTheDocument();
  expect(screen.getByText("タスクは未選択です")).toBeInTheDocument();
});
