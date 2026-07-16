// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MusicTrack } from "../domain";

const context = vi.hoisted(() => {
  const makeTrack = (id: string, title: string, overrides: Partial<MusicTrack> = {}): MusicTrack => ({
    id,
    parentTrackId: null,
    title,
    description: `${title}の説明`,
    theme: "mood-alchemy",
    arrangement: "ambient",
    brightness: "medium",
    density: "medium",
    motion: "low",
    bpm: 64,
    tailSeconds: 3,
    sourcePath: `/tmp/${id}.ck`,
    sourceSha256: `${id}-sha`,
    canonicalSeed: 7,
    rating: null,
    favorite: false,
    recipeVersion: 1,
    recipeJson: JSON.stringify({ version: 1, moods: [{ moodId: "scene-rainy-window", weight: 1 }] }),
    structureFamily: "ambient",
    createdAt: "2026-07-15T00:00:00Z",
    ...overrides,
  });

  return {
    makeTrack,
    tracks: [] as MusicTrack[],
    libraryTracks: [] as MusicTrack[],
    libraryQuery: { sort: "created_desc" },
    musicPlayback: { status: "stopped", trackId: null, disabled: false } as {
      status: "stopped" | "playing" | "paused";
      trackId: string | null;
      disabled: boolean;
    },
    selectedTrackId: null as string | null,
    settings: {
      version: 1 as const,
      closeBehavior: "hide" as const,
      launchAtLogin: false,
      defaultPresetId: "standard",
      autoStartBreak: false,
      notificationsEnabled: true,
      masterVolume: 1,
      playSelectedTrackOnFocus: true,
      crossfadeSeconds: 2,
    },
    setLibraryQuery: vi.fn().mockResolvedValue(undefined),
    renameTrack: vi.fn(),
    deleteTracks: vi.fn(),
    previewTrack: vi.fn().mockResolvedValue(undefined),
    stopMusic: vi.fn().mockResolvedValue(undefined),
    pauseMusic: vi.fn().mockResolvedValue(undefined),
    resumeMusic: vi.fn().mockResolvedValue(undefined),
    selectTrack: vi.fn().mockResolvedValue(undefined),
    saveSettings: vi.fn(),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
    loadTrackSource: vi.fn().mockResolvedValue("Math.srandom(__LYRA_SEED__);"),
    dispatchTimer: vi.fn(),
  };
});

vi.mock("../state/LyraContext", () => ({ useLyra: () => context }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { LibraryScreen, prepareBulkDeleteIds } from "./LibraryScreen";

beforeEach(() => {
  context.tracks = [
    context.makeTrack("rain-1", "Rain Atlas"),
    context.makeTrack("rain-2", "Rain Study", { favorite: true, arrangement: "lofi", structureFamily: "lofi" }),
    context.makeTrack("sun-1", "Sun Room", { arrangement: "neoclassical", structureFamily: "neoclassical" }),
  ];
  context.libraryTracks = context.tracks;
  context.libraryQuery = { sort: "created_desc" };
  context.musicPlayback = { status: "stopped", trackId: null, disabled: false };
  context.selectedTrackId = null;
  context.settings.masterVolume = 1;
  context.setLibraryQuery.mockReset().mockResolvedValue(undefined);
  context.renameTrack.mockReset().mockImplementation(async (id: string, title: string) => ({
    ...context.tracks.find((track) => track.id === id)!,
    title,
  }));
  context.deleteTracks.mockReset().mockImplementation(async (ids: string[]) => ({ deletedIds: ids, unlinkedChildIds: [] }));
  context.previewTrack.mockReset().mockResolvedValue(undefined);
  context.stopMusic.mockReset().mockResolvedValue(undefined);
  context.pauseMusic.mockReset().mockResolvedValue(undefined);
  context.resumeMusic.mockReset().mockResolvedValue(undefined);
  context.selectTrack.mockReset().mockResolvedValue(undefined);
  context.saveSettings.mockReset().mockImplementation(async (settings) => settings);
  context.toggleFavorite.mockReset().mockResolvedValue(undefined);
  context.loadTrackSource.mockReset().mockResolvedValue("Math.srandom(__LYRA_SEED__);");
  context.dispatchTimer.mockReset();
});

afterEach(cleanup);

describe("ライブラリの検索と選択", () => {
  test("全選択は現在の検索・フィルタ結果だけを対象にする", async () => {
    const user = userEvent.setup();
    render(<LibraryScreen />);

    await user.type(screen.getByRole("searchbox", { name: "曲を検索" }), "Rain");
    await user.click(screen.getByRole("checkbox", { name: "検索結果をすべて選択" }));

    expect(screen.getByText("2曲を選択中")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Rain Atlasを選択" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Rain Studyを選択" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Sun Roomを選択" })).not.toBeInTheDocument();
    expect(context.setLibraryQuery).toHaveBeenLastCalledWith(expect.objectContaining({ query: "Rain" }));
  });

  test("再生中の曲が検索結果から外れても固定プレイヤーはその曲を表示する", async () => {
    const user = userEvent.setup();
    context.musicPlayback = { status: "playing", trackId: "rain-1", disabled: false };
    context.libraryTracks = [context.tracks[1]];
    render(<LibraryScreen />);

    const player = screen.getByLabelText("WebChucKプレイヤー");
    expect(within(player).getByText("Rain Atlas")).toBeInTheDocument();
    expect(within(player).queryByText("Rain Study")).not.toBeInTheDocument();
    await user.click(within(player).getByRole("button", { name: "一時停止" }));
    expect(context.pauseMusic).toHaveBeenCalledOnce();
  });
});

describe("曲名のインライン編集", () => {
  test("Enterでtrimした1〜100文字の曲名を保存する", async () => {
    const user = userEvent.setup();
    render(<LibraryScreen />);

    await user.click(screen.getByRole("button", { name: "曲名を変更: Rain Atlas" }));
    const input = screen.getByRole("textbox", { name: "Rain Atlasの新しい曲名" });
    await user.clear(input);
    await user.type(input, "  夜の雨  {Enter}");

    await waitFor(() => expect(context.renameTrack).toHaveBeenCalledWith("rain-1", "夜の雨"));
  });

  test("Escapeで編集を破棄する", async () => {
    const user = userEvent.setup();
    render(<LibraryScreen />);

    await user.click(screen.getByRole("button", { name: "曲名を変更: Rain Atlas" }));
    const input = screen.getByRole("textbox", { name: "Rain Atlasの新しい曲名" });
    await user.clear(input);
    await user.type(input, "保存しない{Escape}");

    expect(context.renameTrack).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "曲名を変更: Rain Atlas" })).toBeInTheDocument();
  });

  test("空白だけまたは101文字は保存せず入力エラーを表示する", async () => {
    const user = userEvent.setup();
    render(<LibraryScreen />);

    await user.click(screen.getByRole("button", { name: "曲名を変更: Rain Atlas" }));
    const input = screen.getByRole("textbox", { name: "Rain Atlasの新しい曲名" });
    await user.clear(input);
    await user.type(input, "   {Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("曲名は1〜100文字で入力してください");
    expect(context.renameTrack).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, `${"あ".repeat(101)}{Enter}`);
    expect(screen.getByRole("alert")).toHaveTextContent("曲名は1〜100文字で入力してください");
    expect(context.renameTrack).not.toHaveBeenCalled();
  });
});

describe("一括削除", () => {
  test("確認文言に重複除去後の選択曲数を正確に表示する", async () => {
    const user = userEvent.setup();
    render(<LibraryScreen />);
    await user.click(screen.getByRole("checkbox", { name: "Rain Atlasを選択" }));
    await user.click(screen.getByRole("checkbox", { name: "Rain Studyを選択" }));
    await user.click(screen.getByRole("button", { name: "選択した曲を削除" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "選択した2曲を完全に削除しますか？" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "完全に削除" }));
    await waitFor(() => expect(context.deleteTracks).toHaveBeenCalledWith(["rain-1", "rain-2"]));
  });

  test.each([
    ["playing", "rain-1"],
    ["stopped", null],
  ] as const)("再生状態が%sでも停止順序とタイマーをcontextへ委譲する", async (status, trackId) => {
    const user = userEvent.setup();
    context.musicPlayback = { status, trackId, disabled: false };
    render(<LibraryScreen />);
    await user.click(screen.getByRole("checkbox", { name: "Rain Atlasを選択" }));
    await user.click(screen.getByRole("button", { name: "選択した曲を削除" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "完全に削除" }));

    await waitFor(() => expect(context.deleteTracks).toHaveBeenCalledWith(["rain-1"]));
    expect(context.stopMusic).not.toHaveBeenCalled();
    expect(context.dispatchTimer).not.toHaveBeenCalled();
  });

  test("重複を除去し、201件の指定を拒否する", () => {
    expect(prepareBulkDeleteIds(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(() => prepareBulkDeleteIds(Array.from({ length: 201 }, (_, index) => `track-${index}`))).toThrow(
      "一度に削除できるのは200曲までです",
    );
  });
});
