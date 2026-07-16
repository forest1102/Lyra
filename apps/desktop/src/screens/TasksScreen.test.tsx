// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const context = vi.hoisted(() => ({
  tasks: [] as Array<Record<string, unknown>>,
  projects: [
    { id: "project-lyra", name: "Lyra", color: null, position: 0 },
    { id: "project-writing", name: "執筆", color: null, position: 1 },
  ],
  tags: [{ id: "tag-deep", name: "Deep" }],
  selectedTaskIds: [] as string[],
  selectedPomodoroTotal: 0,
  timer: { preset: { id: "standard" }, phase: "focus", status: "idle", remainingSeconds: 1_500, completedFocusCycles: 0, deadlineMs: null },
  addTask: vi.fn(),
  addTaskV2: vi.fn().mockResolvedValue(undefined),
  updateTask: vi.fn().mockResolvedValue(undefined),
  saveProject: vi.fn().mockImplementation(async (project) => ({ ...project, id: "project-new" })),
  saveTag: vi.fn().mockImplementation(async (tag) => ({ ...tag, id: "tag-new" })),
  reorderTasks: vi.fn().mockResolvedValue(undefined),
  toggleTask: vi.fn().mockResolvedValue(undefined),
  moveTask: vi.fn(),
  selectTask: vi.fn(),
  dispatchTimer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../state/LyraContext", () => ({ useLyra: () => context }));

import { TasksScreen, filterTasksForView, reorderIdsInStatus } from "./TasksScreen";

Element.prototype.scrollIntoView ??= vi.fn();
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= vi.fn();
HTMLElement.prototype.releasePointerCapture ??= vi.fn();

const makeTask = (overrides: Record<string, unknown>) => ({
  id: "task", title: "タスク", list: "backlog", completed: false,
  estimatedPomodoros: 1, status: "inbox", priority: "none", projectId: null,
  parentId: null, notes: "", plannedDate: null, dueDate: null,
  position: 0, completedAt: null, recurrence: null, tags: [],
  createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  context.projects = [
    { id: "project-lyra", name: "Lyra", color: null, position: 0 },
    { id: "project-writing", name: "執筆", color: null, position: 1 },
  ];
  context.tags = [{ id: "tag-deep", name: "Deep" }];
  context.tasks = [
    makeTask({ id: "overdue", title: "期限超過", dueDate: "2026-07-14", estimatedPomodoros: 2, position: 0 }),
    makeTask({ id: "today", title: "今日の予定", status: "active", list: "today", plannedDate: "2026-07-15", estimatedPomodoros: 3, projectId: "project-lyra", notes: "集中して仕上げる", position: 1 }),
    makeTask({ id: "future", title: "近日の予定", plannedDate: "2026-07-17", position: 2 }),
    makeTask({ id: "done", title: "完了した仕事", status: "completed", completed: true, completedAt: "2026-07-14T02:00:00Z", position: 3 }),
    makeTask({ id: "subtask", title: "章立てを確認", parentId: "today", status: "active", list: "today", position: 0 }),
  ];
  context.selectedTaskIds = [];
  context.selectedPomodoroTotal = 0;
  context.timer = { ...context.timer, phase: "focus", status: "idle" };
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("filterTasksForView", () => {
  test("今日には期限超過と予定日が今日の未完了タスクだけを含める", () => {
    expect(filterTasksForView(context.tasks as never[], { kind: "today" }, "2026-07-15").map((task) => task.id)).toEqual(["overdue", "today"]);
  });

  test("近日・完了・プロジェクトをそれぞれ絞り込む", () => {
    expect(filterTasksForView(context.tasks as never[], { kind: "upcoming" }, "2026-07-15").map((task) => task.id)).toEqual(["future"]);
    expect(filterTasksForView(context.tasks as never[], { kind: "completed" }, "2026-07-15").map((task) => task.id)).toEqual(["done"]);
    expect(filterTasksForView(context.tasks as never[], { kind: "project", projectId: "project-lyra" }, "2026-07-15").map((task) => task.id)).toEqual(["today"]);
  });
});

test("並べ替えは画面で隠れている同じstatusの位置も保持して一意にする", () => {
  const tasks = [
    makeTask({ id: "visible-a", status: "inbox", position: 0 }),
    makeTask({ id: "hidden", status: "inbox", position: 1, projectId: "other" }),
    makeTask({ id: "visible-b", status: "inbox", position: 2 }),
    makeTask({ id: "active", status: "active", position: 0 }),
  ];
  expect(reorderIdsInStatus(tasks as never[], "visible-a", "visible-b", "inbox")).toEqual(["hidden", "visible-b", "visible-a"]);
});

test("二次ナビで表示を切り替え、行の展開時だけメモとサブタスクを見せる", async () => {
  const user = userEvent.setup();
  render(<TasksScreen today="2026-07-15" />);

  await user.click(screen.getByRole("button", { name: /今日/ }));
  expect(screen.getByText("期限超過")).toBeInTheDocument();
  expect(screen.getByText("今日の予定")).toBeInTheDocument();
  expect(screen.queryByText("近日の予定")).not.toBeInTheDocument();
  expect(screen.queryByText("集中して仕上げる")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "今日の予定を展開" }));
  expect(screen.getByText("集中して仕上げる")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "章立てを確認の名前" })).toHaveValue("章立てを確認");

  await user.click(screen.getByRole("button", { name: "章立てを確認を完了にする" }));
  expect(context.toggleTask).toHaveBeenCalledWith("subtask");
  const subtaskTitle = screen.getByRole("textbox", { name: "章立てを確認の名前" });
  await user.clear(subtaskTitle);
  await user.type(subtaskTitle, "章構成を確認");
  await user.tab();
  expect(context.updateTask).toHaveBeenCalledWith("subtask", { title: "章構成を確認" });
});

test("本番データが空でもプロジェクトとタグを作成できる", async () => {
  const user = userEvent.setup();
  context.projects = [];
  context.tags = [];
  render(<TasksScreen today="2026-07-15" />);

  await user.click(screen.getByRole("button", { name: "プロジェクトを追加" }));
  await user.type(screen.getByRole("textbox", { name: "プロジェクト名" }), "新規開発");
  await user.click(screen.getByRole("button", { name: "作成" }));
  expect(context.saveProject).toHaveBeenCalledWith({ id: "", name: "新規開発", color: null, position: 0 });

  await user.click(screen.getByRole("button", { name: /今日/ }));
  await user.click(screen.getByRole("button", { name: "今日の予定を展開" }));
  await user.click(screen.getByRole("button", { name: /タグ/ }));
  await user.type(screen.getByPlaceholderText("タグを検索…"), "重要");
  await user.click(screen.getByRole("option", { name: "「重要」を作成" }));
  await waitFor(() => expect(context.saveTag).toHaveBeenCalledWith({ id: "", name: "重要" }));
  expect(context.updateTask).toHaveBeenCalledWith("today", { tagIds: ["tag-new"] });
});

test("選択中の件数とPomodoro合計を表示して集中を開始する", async () => {
  const user = userEvent.setup();
  const onStartFocus = vi.fn();
  context.selectedTaskIds = ["overdue", "today"];
  context.selectedPomodoroTotal = 5;
  render(<TasksScreen today="2026-07-15" onStartFocus={onStartFocus} />);

  await user.click(screen.getByRole("button", { name: /今日/ }));
  expect(screen.getByText("2件を選択")).toBeInTheDocument();
  expect(screen.getByText("合計 5 Pomodoro")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "選んだタスクで集中" }));
  expect(context.dispatchTimer).toHaveBeenCalledWith({ type: "start", nowMs: expect.any(Number) });
  await waitFor(() => expect(onStartFocus).toHaveBeenCalledOnce());
});

test("休憩中はタスク画面から新しい集中を開始できない", () => {
  context.selectedTaskIds = ["today"];
  context.selectedPomodoroTotal = 3;
  context.timer = { ...context.timer, phase: "short_break", status: "running" };
  render(<TasksScreen today="2026-07-15" />);

  expect(screen.getByText("休憩終了後に開始できます")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "選んだタスクで集中" })).toBeDisabled();
  expect(context.dispatchTimer).not.toHaveBeenCalled();
});

test("CalendarとProject Commandから日付とプロジェクトを更新できる", async () => {
  const user = userEvent.setup();
  render(<TasksScreen today="2026-07-15" />);
  await user.click(screen.getByRole("button", { name: /今日/ }));

  const row = screen.getByTestId("task-row-today");
  await user.click(within(row).getByRole("button", { name: "今日の予定の予定日" }));
  await user.click(screen.getByRole("button", { name: /16/ }));
  expect(context.updateTask).toHaveBeenCalledWith("today", { plannedDate: "2026-07-16" });

  await user.click(within(row).getByRole("button", { name: "今日の予定のプロジェクト" }));
  await user.click(screen.getByRole("option", { name: "執筆" }));
  expect(context.updateTask).toHaveBeenCalledWith("today", { projectId: "project-writing" });
});

test("ドラッグハンドルのキーボード操作で現在のstatus内だけを並べ替える", async () => {
  render(<TasksScreen today="2026-07-15" />);
  fireEvent.keyDown(screen.getByRole("button", { name: "期限超過を並べ替え" }), { key: "ArrowDown", altKey: true });

  expect(context.reorderTasks).toHaveBeenCalledWith(["future", "overdue"], "inbox");
});

test("繰り返しタスクは予定日か期限を選ぶまで追加できない", async () => {
  const user = userEvent.setup();
  render(<TasksScreen today="2026-07-15" />);

  await user.type(screen.getByRole("textbox", { name: "新しいタスク" }), "毎日の振り返り");
  await user.click(screen.getByRole("button", { name: "詳細" }));
  await user.click(screen.getByRole("combobox", { name: "繰り返し" }));
  await user.click(screen.getByRole("option", { name: "毎日" }));

  expect(screen.getByText("繰り返しタスクには予定日または期限が必要です")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
});

test("近日のタスクは今日より後の日付を選ぶまで追加できない", async () => {
  const user = userEvent.setup();
  render(<TasksScreen today="2026-07-15" />);
  await user.click(screen.getByRole("button", { name: "近日" }));
  await user.type(screen.getByRole("textbox", { name: "新しいタスク" }), "次の計画");
  expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "詳細" }));
  expect(screen.getByText("近日のタスクには今日より後の予定日または期限が必要です")).toBeInTheDocument();
});

test("完了したタスクは集中対象に選択できない", async () => {
  const user = userEvent.setup();
  context.selectedTaskIds = ["done"];
  context.selectedPomodoroTotal = 1;
  render(<TasksScreen today="2026-07-15" />);
  await user.click(screen.getByRole("button", { name: "完了" }));

  expect(screen.getByRole("checkbox", { name: "完了した仕事を集中対象に選択" })).toBeDisabled();
  expect(screen.getByText("0件を選択")).toBeInTheDocument();
});
