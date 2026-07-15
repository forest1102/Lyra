// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

afterEach(cleanup);

const context = vi.hoisted(() => ({
  draft: {
    id: "draft-1",
    title: "Generated Focus",
    description: "quiet",
    theme: "deep-space",
    bpm: 60,
    tailSeconds: 2,
    audioValidation: "passed"
  },
  musicPlayback: { status: "stopped", trackId: null } as { status: string; trackId: string | null },
  generateTrack: vi.fn(),
  cancelMusicGeneration: vi.fn().mockResolvedValue(undefined),
  previewDraft: vi.fn().mockResolvedValue(undefined),
  stopMusic: vi.fn().mockResolvedValue(undefined),
  saveDraft: vi.fn(),
  discardDraft: vi.fn()
}));

vi.mock("../state/LyraContext", () => ({ useLyra: () => context }));

import { StudioScreen } from "./StudioScreen";

test("試聴ボタンが再生中は停止に切り替わる", async () => {
  const user = userEvent.setup();
  const view = render(<StudioScreen />);

  await user.click(screen.getByRole("button", { name: "▶ 再生" }));
  expect(context.previewDraft).toHaveBeenCalledWith(context.draft);

  context.musicPlayback = { status: "playing", trackId: "draft-1" };
  view.rerender(<StudioScreen />);
  await user.click(screen.getByRole("button", { name: "■ 停止" }));
  expect(context.stopMusic).toHaveBeenCalledOnce();
});

test("選択した曲調をBGM生成要求に含める", async () => {
  const user = userEvent.setup();
  context.generateTrack.mockReset().mockResolvedValue({
    ...context.draft,
    arrangement: "lofi",
    audioValidation: "deferred_until_focus_ends"
  });
  render(<StudioScreen />);

  await user.click(screen.getByRole("button", { name: "Lo-fi" }));
  await user.click(screen.getByRole("button", { name: "生成する" }));

  await waitFor(() => expect(context.generateTrack).toHaveBeenCalledWith(
    expect.objectContaining({ arrangement: "lofi" }),
    expect.any(Function)
  ));
});

test("ライブコーディングを画面から中止できる", async () => {
  const user = userEvent.setup();
  context.generateTrack.mockImplementation((_request, onProgress) => {
    onProgress?.({ phase: "coding" });
    return new Promise(() => undefined);
  });
  render(<StudioScreen />);

  await user.click(screen.getByRole("button", { name: "生成する" }));
  await user.click(await screen.findByRole("button", { name: "生成を中止" }));

  expect(context.cancelMusicGeneration).toHaveBeenCalledOnce();
});
