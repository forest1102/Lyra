import type { RuntimeDiagnostic } from "../domain";

interface DiagnosticEnvironment {
  fetch: typeof globalThis.fetch;
  createAudioContext: () => AudioContext;
}

function failed(component: RuntimeDiagnostic["component"], message: string, remediation: string): RuntimeDiagnostic {
  return { component, status: "error", message, remediation };
}

export async function browserRuntimeDiagnostics(environment: Partial<DiagnosticEnvironment> = {}): Promise<RuntimeDiagnostic[]> {
  const fetchAsset = environment.fetch ?? globalThis.fetch.bind(globalThis);
  const createAudioContext = environment.createAudioContext ?? (() => new AudioContext());
  const diagnostics: RuntimeDiagnostic[] = [];

  try {
    const responses = await Promise.all([
      fetchAsset("/webchuck/webchuck.js", { cache: "no-store" }),
      fetchAsset("/webchuck/webchuck.wasm", { cache: "no-store" }),
    ]);
    if (responses.every((response) => response.ok)) {
      diagnostics.push({ component: "webchuck-assets", status: "ok", message: "WebChucK JS/WASM assets are available" });
    } else {
      diagnostics.push(failed("webchuck-assets", "WebChucK JS/WASM assets are missing", "アプリを再インストールしてください"));
    }
  } catch {
    diagnostics.push(failed("webchuck-assets", "WebChucK JS/WASM assets could not be loaded", "アプリを再インストールしてください"));
  }

  let context: AudioContext | null = null;
  try {
    context = createAudioContext();
    diagnostics.push({
      component: "audio-context",
      status: context.state === "suspended" ? "warning" : "ok",
      message: context.state === "suspended" ? "AudioContext is waiting for a user gesture" : "AudioContext is available",
      remediation: context.state === "suspended" ? "再生ボタンをクリックして音声を有効にしてください" : undefined,
    });
    try {
      await context.audioWorklet.addModule("/worklets/lyra-validation-meter.js");
      diagnostics.push({ component: "worklet", status: "ok", message: "Validation AudioWorklet is available" });
    } catch {
      diagnostics.push(failed("worklet", "Validation AudioWorklet could not be loaded", "アプリを再インストールしてください"));
    }
  } catch {
    diagnostics.push(failed("audio-context", "AudioContext is unavailable", "OSの音声出力とアプリの音声権限を確認してください"));
    diagnostics.push(failed("worklet", "AudioWorklet could not be checked", "AudioContextの問題を解決してから再診断してください"));
  } finally {
    await context?.close().catch(() => undefined);
  }

  return diagnostics;
}
