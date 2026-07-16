// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MusicDraft } from "../domain";
import { createMusicRecipe } from "../services/moodCatalog";

const createDraft = (audioValidation: MusicDraft["audioValidation"] = "pending"): MusicDraft => ({
  id: "draft-1",
  parentTrackId: null,
  title: "雨の窓辺の錬金術",
  description: "静かな雨と温かな倍音がゆっくり溶け合います。",
  theme: "mood-alchemy",
  arrangement: "ambient",
  brightness: "medium",
  density: "medium",
  motion: "low",
  bpm: 62,
  tailSeconds: 3,
  chuckSource: "SinOsc tone => dac; 5::second => now;",
  sourceSha256: "sha",
  canonicalSeed: 7,
  audioValidation,
  recipeVersion: 1,
  recipeJson: JSON.stringify(createMusicRecipe(["scene-rainy-window"])),
  structureFamily: "ambient",
});

const context = vi.hoisted(() => ({
  draft: null as MusicDraft | null,
  timer: { status: "idle" },
  musicPlayback: { status: "stopped", trackId: null, disabled: false } as {
    status: "stopped" | "playing" | "paused";
    trackId: string | null;
    disabled: boolean;
  },
  generateTrack: vi.fn(),
  cancelMusicGeneration: vi.fn(),
  previewDraft: vi.fn(),
  stopMusic: vi.fn(),
  saveDraft: vi.fn(),
  discardDraft: vi.fn(),
}));

vi.mock("../state/LyraContext", () => ({ useLyra: () => context }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { StudioScreen, rebalanceRecipeWeight } from "./StudioScreen";

beforeEach(() => {
  context.draft = null;
  context.timer = { status: "idle" };
  context.musicPlayback = { status: "stopped", trackId: null, disabled: false };
  context.generateTrack.mockReset().mockResolvedValue(createDraft());
  context.cancelMusicGeneration.mockReset().mockResolvedValue(undefined);
  context.previewDraft.mockReset().mockResolvedValue(createDraft("passed"));
  context.stopMusic.mockReset().mockResolvedValue(undefined);
  context.saveDraft.mockReset().mockResolvedValue(undefined);
  context.discardDraft.mockReset();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Music Alchemyのムード選択", () => {
  test("5分類から各6枚のローカルムードを切り替えて表示する", async () => {
    const user = userEvent.setup();
    render(<StudioScreen />);

    expect(screen.getByRole("heading", { name: "どんな空間で集中する？" })).toBeInTheDocument();
    const categories = screen.getByRole("radiogroup", { name: "ムードの分類" });
    expect(within(categories).getAllByRole("radio")).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: /^(雨の窓辺|静かな書庫|深い森|遠い海辺|夜行列車|雪の部屋)$/ })).toHaveLength(6);

    await user.click(screen.getByRole("radio", { name: "時間帯" }));
    expect(screen.getAllByRole("button", { name: /^(夜明け|朝|昼下がり|黄昏|深夜|蒼い時間)$/ })).toHaveLength(6);
    expect(screen.getByRole("img", { name: "夜明け" })).toHaveAttribute("src", "/moods/time-dawn.webp");
  });

  test("選択は1〜5件に保ち、新しく選ぶと初期重みを均等にする", async () => {
    const user = userEvent.setup();
    render(<StudioScreen />);

    await user.click(screen.getByRole("button", { name: "静かな書庫" }));
    await user.click(screen.getByRole("button", { name: "深い森" }));
    expect(screen.getAllByRole("slider")).toHaveLength(5);
    for (const slider of screen.getAllByRole("slider")) expect(slider).toHaveAttribute("aria-valuenow", "20");

    await user.click(screen.getByRole("button", { name: "遠い海辺" }));
    expect(screen.getAllByRole("slider")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "遠い海辺" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "雨の窓辺" }));
    await user.click(screen.getByRole("button", { name: "静かな書庫" }));
    await user.click(screen.getByRole("button", { name: "深い森" }));
    await user.click(screen.getByRole("radio", { name: "温度" }));
    await user.click(screen.getByRole("button", { name: "陽だまり" }));
    await user.click(screen.getByRole("radio", { name: "質感" }));
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "ベルベット" }));
    expect(screen.getByRole("button", { name: "ベルベット" })).toHaveAttribute("aria-pressed", "true");
  });

  test("ひとつの重みを変えると残りの比率を保って合計1に再正規化する", () => {
    const recipe = createMusicRecipe(["scene-rainy-window", "time-midnight", "texture-velvet"]);

    expect(rebalanceRecipeWeight(recipe, "scene-rainy-window", 0.6).moods).toEqual([
      { moodId: "scene-rainy-window", weight: 0.6 },
      { moodId: "time-midnight", weight: 0.2 },
      { moodId: "texture-velvet", weight: 0.2 },
    ]);
  });

  test("極端な重みでも他のムードをSliderの最小値未満にしない", () => {
    const recipe = createMusicRecipe(["scene-rainy-window", "time-midnight", "texture-velvet"]);

    const weighted = rebalanceRecipeWeight(recipe, "scene-rainy-window", 0.99);
    expect(weighted.moods.reduce((total, mood) => total + mood.weight, 0)).toBeCloseTo(1);
    expect(weighted.moods.every((mood) => mood.weight >= 0.01)).toBe(true);
  });

  test("各スライダーをムード名で識別できる", () => {
    render(<StudioScreen />);

    expect(screen.getByRole("slider", { name: "雨の窓辺の重み" })).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByRole("slider", { name: "陽だまりの重み" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "ベルベットの重み" })).toBeInTheDocument();
  });
});

describe("Music Alchemyの生成フロー", () => {
  test("正規化したversion付きrecipeだけを生成要求として送って自動再生しない", async () => {
    const user = userEvent.setup();
    render(<StudioScreen />);

    await user.click(screen.getByRole("button", { name: "このムードで生成" }));

    await waitFor(() => expect(context.generateTrack).toHaveBeenCalledOnce());
    expect(context.generateTrack).toHaveBeenCalledWith({
      version: 1,
      moods: [
        { moodId: "scene-rainy-window", weight: expect.closeTo(1 / 3, 8) },
        { moodId: "temperature-sunlight", weight: expect.closeTo(1 / 3, 8) },
        { moodId: "texture-velvet", weight: expect.closeTo(1 / 3, 8) },
      ],
    }, expect.any(Function));
    expect(context.previewDraft).not.toHaveBeenCalled();
  });

  test("生成中は進捗を表示し、画面から生成を中止できる", async () => {
    const user = userEvent.setup();
    context.generateTrack.mockImplementation((_request, onProgress) => {
      onProgress?.({ phase: "coding" });
      return new Promise(() => undefined);
    });
    render(<StudioScreen />);

    await user.click(screen.getByRole("button", { name: "このムードで生成" }));
    expect(await screen.findByText("ChucKをコーディングしています")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "生成を中止" }));

    expect(context.cancelMusicGeneration).toHaveBeenCalledOnce();
  });

  test("生成プロセスの停止確認までは再生成を有効にしない", async () => {
    const user = userEvent.setup();
    let acknowledgeCancellation!: () => void;
    context.generateTrack.mockImplementation((_request, onProgress) => {
      onProgress?.({ phase: "coding" });
      return new Promise(() => undefined);
    });
    context.cancelMusicGeneration.mockReturnValue(new Promise<void>((resolve) => { acknowledgeCancellation = resolve; }));
    render(<StudioScreen />);

    await user.click(screen.getByRole("button", { name: "このムードで生成" }));
    await user.click(screen.getByRole("button", { name: "生成を中止" }));

    expect(screen.getByRole("button", { name: "中止しています" })).toBeDisabled();
    acknowledgeCancellation();
    await waitFor(() => expect(screen.getByRole("button", { name: "このムードで生成" })).toBeEnabled());
  });

  test("中止した古い生成の失敗が直後の新しい生成を上書きしない", async () => {
    const user = userEvent.setup();
    let rejectOld!: (reason: unknown) => void;
    context.generateTrack
      .mockImplementationOnce((_request, onProgress) => {
        onProgress?.({ phase: "coding" });
        return new Promise((_resolve, reject) => { rejectOld = reject; });
      })
      .mockResolvedValueOnce(createDraft());
    render(<StudioScreen />);

    await user.click(screen.getByRole("button", { name: "このムードで生成" }));
    await user.click(screen.getByRole("button", { name: "生成を中止" }));
    await user.click(screen.getByRole("button", { name: "このムードで生成" }));
    rejectOld(new Error("old generation failed"));

    expect(await screen.findByText("コードが完成しました。再生前に5秒検証してください")).toBeInTheDocument();
    expect(screen.queryByText(/old generation failed/)).not.toBeInTheDocument();
  });

  test("生成後は明示クリックで5秒検証・再生し、合格後だけ保存できる", async () => {
    const user = userEvent.setup();
    context.draft = createDraft("pending");
    const view = render(<StudioScreen />);

    const save = screen.getByRole("button", { name: "ライブラリに保存" });
    expect(save).toBeDisabled();
    expect(context.previewDraft).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "検証して再生" }));
    expect(context.previewDraft).toHaveBeenCalledWith(context.draft, expect.any(Function));

    context.draft = createDraft("passed");
    view.rerender(<StudioScreen />);
    await user.click(screen.getByRole("button", { name: "ライブラリに保存" }));
    expect(context.saveDraft).toHaveBeenCalledOnce();
  });

  test("集中中に延期された音声検証を説明し、タイマーには触れない", async () => {
    const user = userEvent.setup();
    context.timer = { status: "running" };
    context.draft = createDraft("deferred_until_focus_ends");
    render(<StudioScreen />);

    expect(screen.getByText("集中セッションを止めず、終了後に5秒の音声検証を再開します。")).toBeInTheDocument();
    const deferred = screen.getByRole("button", { name: "集中終了後に検証" });
    expect(deferred).toBeDisabled();
    await user.click(deferred);
    expect(context.previewDraft).not.toHaveBeenCalled();
  });
});
