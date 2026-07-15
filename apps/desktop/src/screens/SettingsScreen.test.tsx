// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
const context = vi.hoisted(() => ({
  presets: [{ id: "standard", name: "Standard", focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLongBreak: 4, builtIn: true }],
  savePreset: vi.fn(),
}));

vi.mock("../state/LyraContext", () => ({ useLyra: () => context }));

import { SettingsScreen } from "./SettingsScreen";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("音声出力の選択やマイク権限を設定に表示しない", () => {
  render(<SettingsScreen />);

  expect(screen.queryByText("オーディオ出力")).not.toBeInTheDocument();
  expect(screen.queryByText(/マイク権限/)).not.toBeInTheDocument();
});
