import { afterEach, describe, expect, test, vi } from "vitest";
import { EventRequestBroker, type IpcResult } from "./eventRequest";

afterEach(() => vi.useRealTimers());

function harness(timeoutMs = 10_000) {
  let onResult: ((event: { payload: IpcResult }) => void) | undefined;
  const unlisten = vi.fn();
  const listen = vi.fn(async (_event: string, listener: typeof onResult) => {
    onResult = listener;
    return unlisten;
  });
  const emit = vi.fn().mockResolvedValue(undefined);
  const broker = new EventRequestBroker({ emit, listen, timeoutMs, createRequestId: () => "request-1" });
  return { broker, emit, onResult: (result: IpcResult) => onResult?.({ payload: result }), unlisten };
}

describe("Event request broker", () => {
  test("requestIdが一致する成功応答でPromiseを解決する", async () => {
    const target = harness();
    const pending = target.broker.request<{ status: string }>("timer://control", { action: "stop" });
    await vi.waitFor(() => expect(target.emit).toHaveBeenCalledWith("timer://control", {
      requestId: "request-1",
      action: "stop"
    }));

    target.onResult({ requestId: "request-1", ok: true, data: { status: "stopped" } });

    await expect(pending).resolves.toEqual({ status: "stopped" });
  });

  test("Rustの失敗応答をErrorとして返す", async () => {
    const target = harness();
    const pending = target.broker.request("timer://control", { action: "start" });
    await vi.waitFor(() => expect(target.emit).toHaveBeenCalledOnce());

    target.onResult({ requestId: "request-1", ok: false, error: "timer rejected" });

    await expect(pending).rejects.toThrow("timer rejected");
  });

  test("応答がなければtimeoutし、disposeでlistenerを解除する", async () => {
    vi.useFakeTimers();
    const target = harness(50);
    const pending = target.broker.request("timer://control", { action: "play" });
    const rejection = expect(pending).rejects.toThrow("timer://control timed out");
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    target.broker.dispose();
    expect(target.unlisten).toHaveBeenCalledOnce();
  });
});
