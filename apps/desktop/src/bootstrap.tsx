import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppGate } from "./App";
import { desktopBridge, type DesktopBridge } from "./services/desktop";
import type { AppRuntime } from "./services/runtime";
import { LyraProvider } from "./state/LyraContext";

async function bridgeForRuntime(runtime: AppRuntime): Promise<DesktopBridge | null> {
  if (runtime === "unsupported-browser") return null;
  if (import.meta.env.DEV && runtime === "browser-development") {
    const { createBrowserDevBridge } = await import("./services/browserDev");
    return createBrowserDevBridge();
  }
  return desktopBridge;
}

function DesktopAppRequired() {
  return (
    <main role="alert" className="center-state">
      <h1>デスクトップアプリから起動してください</h1>
      <p>LyraはmacOSデスクトップアプリ内で動作します。</p>
    </main>
  );
}

export async function bootstrapLyra(rootElement: HTMLElement, runtime: AppRuntime): Promise<() => void> {
  if (runtime === "tauri-e2e") await import("@wdio/tauri-plugin");

  const bridge = await bridgeForRuntime(runtime);
  const root = createRoot(rootElement);
  if (!bridge) {
    root.render(<StrictMode><DesktopAppRequired /></StrictMode>);
  } else {
    root.render(
      <StrictMode>
        <LyraProvider bridge={bridge}><AppGate /></LyraProvider>
      </StrictMode>,
    );
  }
  return () => root.unmount();
}
