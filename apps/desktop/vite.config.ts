import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { WEBCHUCK_ASSET_ROOT, webChuckRuntime } from "./viteWebChuck";

export default defineConfig({
  plugins: [react(), ...webChuckRuntime()],
  define: {
    __WEBCHUCK_ASSET_ROOT__: JSON.stringify(WEBCHUCK_ASSET_ROOT),
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  }
});
