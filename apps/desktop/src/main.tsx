import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppGate } from "./App";
import { LyraProvider } from "./state/LyraContext";
import "./styles.css";

async function start() {
  if (import.meta.env.VITE_E2E === "1") {
    await import("@wdio/tauri-plugin");
  }

  const root = document.getElementById("root");
  if (!root) throw new Error("root element was not found");

  createRoot(root).render(
    <StrictMode>
      <LyraProvider><AppGate /></LyraProvider>
    </StrictMode>
  );
}

void start();
