// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DEFAULT_APP_SETTINGS } from "../domain";

const context = vi.hoisted(() => ({
  settings: {
    version: 2 as const,
    closeBehavior: "hide" as const,
    launchAtLogin: false,
    defaultPresetId: "standard",
    autoStartBreak: false,
    notificationsEnabled: true,
    masterVolume: 1.5,
    playSelectedTrackOnFocus: true,
    crossfadeSeconds: 2,
  },
  presets: [
    { id: "standard", name: "Standard", focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLongBreak: 4, builtIn: true },
    { id: "writing", name: "執筆", focusMinutes: 40, shortBreakMinutes: 8, longBreakMinutes: 18, cyclesBeforeLongBreak: 3, builtIn: false },
  ],
  savePreset: vi.fn(),
  deletePreset: vi.fn(),
  saveSettings: vi.fn(async (settings) => settings),
  runtimeDiagnostics: vi.fn(async () => [
    { component: "codex", status: "ok", message: "接続できます" },
    { component: "webchuck-assets", status: "ok", message: "整合性を確認しました" },
    { component: "audio-context", status: "warning", message: "操作後に開始します" },
    { component: "worklet", status: "ok", message: "利用できます" },
    { component: "sqlite", status: "ok", message: "利用できます" },
  ]),
  openDataDirectory: vi.fn(),
}));

vi.mock("../state/LyraContext", () => ({ useLyra: () => context }));

import { SettingsScreen } from "./SettingsScreen";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("5つの設定カテゴリと安全な既定値を表示する", () => {
  render(<SettingsScreen />);

  expect(screen.getByRole("button", { name: "一般" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "集中" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "オーディオ" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ランタイム" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "データ" })).toBeInTheDocument();
  expect(context.settings).toEqual(DEFAULT_APP_SETTINGS);
  expect(screen.queryByText(/SuperCollider/i)).not.toBeInTheDocument();
  expect(screen.queryByText("オーディオ出力")).not.toBeInTheDocument();
  expect(screen.queryByText(/マイク権限/)).not.toBeInTheDocument();
});

test("変更は明示的な保存操作で反映する", async () => {
  render(<SettingsScreen />);

  fireEvent.click(screen.getByRole("button", { name: "オーディオ" }));
  fireEvent.change(screen.getByLabelText("マスター音量"), { target: { value: "165" } });
  fireEvent.change(screen.getByLabelText("クロスフェード"), { target: { value: "4" } });
  expect(context.saveSettings).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));
  await waitFor(() => expect(context.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
    masterVolume: 1.65,
    crossfadeSeconds: 4,
  })));
});

test("マスター音量は150%を標準として1%刻みで200%まで設定できる", () => {
  render(<SettingsScreen />);

  fireEvent.click(screen.getByRole("button", { name: "オーディオ" }));
  expect(screen.getByText(/標準は150%/)).toBeInTheDocument();
  expect(screen.getByLabelText("マスター音量")).toHaveAttribute("max", "200");
  expect(screen.getByLabelText("マスター音量")).toHaveAttribute("step", "1");
  expect(screen.getByLabelText("マスター音量")).toHaveValue(150);
  expect(screen.getByRole("slider", { name: "マスター音量スライダー" })).toHaveAttribute("aria-valuemax", "200");
});

test("カスタムプリセットを削除できる", async () => {
  render(<SettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "集中" }));
  fireEvent.click(screen.getByRole("button", { name: "執筆を削除" }));
  fireEvent.click(screen.getByRole("button", { name: "削除する" }));
  await waitFor(() => expect(context.deletePreset).toHaveBeenCalledWith("writing"));
});

test("5つのランタイム診断を表示しデータフォルダを開ける", async () => {
  render(<SettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "ランタイム" }));
  await waitFor(() => expect(context.runtimeDiagnostics).toHaveBeenCalled());
  for (const label of ["Codex", "WebChucKアセット", "AudioContext", "Worklet", "SQLite"]) {
    expect(await screen.findByText(label)).toBeInTheDocument();
  }
  expect(screen.queryByText(/SuperCollider/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "データ" }));
  fireEvent.click(screen.getByRole("button", { name: "データフォルダを開く" }));
  await waitFor(() => expect(context.openDataDirectory).toHaveBeenCalled());
});
