// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

afterEach(cleanup);

const context = vi.hoisted(() => ({
  tracks: [{
    id: "track-1",
    title: "Night Focus",
    description: "quiet",
    theme: "deep-space",
    bpm: 60,
    favorite: false,
    rating: null,
    parentTrackId: null,
    sourcePath: "/tmp/track.scd",
    sourceSha256: "abc"
  }],
  musicPlayback: { status: "stopped", trackId: null } as { status: string; trackId: string | null },
  previewTrack: vi.fn().mockResolvedValue(undefined),
  stopMusic: vi.fn().mockResolvedValue(undefined),
  rateTrack: vi.fn(),
  toggleFavorite: vi.fn(),
  saveVariation: vi.fn()
}));

vi.mock("../state/LyraContext", () => ({ useLyra: () => context }));

import { LibraryScreen } from "./LibraryScreen";

test("同じボタンが再生中の曲だけ停止に切り替わる", async () => {
  const user = userEvent.setup();
  const view = render(<LibraryScreen />);

  await user.click(screen.getByRole("button", { name: "▶ 再生" }));
  expect(context.previewTrack).toHaveBeenCalledWith("track-1");

  context.musicPlayback = { status: "playing", trackId: "track-1" };
  view.rerender(<LibraryScreen />);
  await user.click(screen.getByRole("button", { name: "■ 停止" }));
  expect(context.stopMusic).toHaveBeenCalledOnce();
});
