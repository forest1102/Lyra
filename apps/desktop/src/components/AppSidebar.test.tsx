// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";

afterEach(cleanup);

test("approved five destinations are keyboard-accessible and stop audio independently", async () => {
  const user = userEvent.setup();
  const onNavigate = vi.fn();
  const onStopMusic = vi.fn();
  render(
    <TooltipProvider>
      <AppSidebar active="focus" onNavigate={onNavigate} onStopMusic={onStopMusic} />
    </TooltipProvider>,
  );

  for (const label of ["集中", "タスク", "Music Alchemy", "ライブラリ", "設定"]) {
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  }
  expect(screen.getByRole("button", { name: "集中" })).toHaveAttribute("aria-current", "page");

  await user.click(screen.getByRole("button", { name: "Music Alchemy" }));
  expect(onNavigate).toHaveBeenCalledWith("studio");
  await user.click(screen.getByRole("button", { name: "音楽を停止" }));
  expect(onStopMusic).toHaveBeenCalledOnce();
});
