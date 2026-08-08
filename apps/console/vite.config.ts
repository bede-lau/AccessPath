/// <reference types="node" />
// Node types are referenced here only (for process.env); src/ stays browser-only.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const developmentPort = Number(
  process.env.ACCESSPATH_DEV_CONSOLE_PORT ?? "5173",
);
if (
  !Number.isInteger(developmentPort) ||
  developmentPort < 1 ||
  developmentPort > 65535
) {
  throw new Error(
    "ACCESSPATH_DEV_CONSOLE_PORT must be an integer from 1 to 65535.",
  );
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: developmentPort,
    strictPort: true,
    proxy: {
      // The dev orchestrator (scripts/dev.mjs) sets ACCESSPATH_DEV_PROXY_PORT
      // to the fixed development-only companion port. This is NOT the product
      // runtime default, which is port 0 (OS-selected).
      "/api": {
        target: `http://127.0.0.1:${process.env.ACCESSPATH_DEV_PROXY_PORT ?? "4801"}`,
        changeOrigin: false,
      },
    },
  },
});
