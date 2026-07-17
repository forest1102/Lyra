// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import { browserRuntimeDiagnostics } from "./diagnostics";

describe("browser runtime diagnostics", () => {
  test("assets, AudioContext, Workletを確認し検査用Contextを解放する", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const addModule = vi.fn().mockResolvedValue(undefined);
    const result = await browserRuntimeDiagnostics({
      fetch: vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch,
      createAudioContext: () => ({ state: "running", audioWorklet: { addModule }, close }) as unknown as AudioContext,
    });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: "webchuck-assets", status: "ok" }),
      expect.objectContaining({ component: "audio-context", status: "ok" }),
      expect.objectContaining({ component: "worklet", status: "ok" }),
    ]));
    expect(addModule).toHaveBeenCalledWith("/worklets/lyra-validation-meter.js");
    expect(close).toHaveBeenCalledOnce();
  });

  test("Worklet失敗を報告してもContextを解放する", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const result = await browserRuntimeDiagnostics({
      fetch: vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch,
      createAudioContext: () => ({
        state: "suspended",
        audioWorklet: { addModule: vi.fn().mockRejectedValue(new Error("missing")) },
        close,
      }) as unknown as AudioContext,
    });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: "webchuck-assets", status: "error" }),
      expect.objectContaining({ component: "audio-context", status: "warning" }),
      expect.objectContaining({ component: "worklet", status: "error" }),
    ]));
    expect(close).toHaveBeenCalledOnce();
  });
});
