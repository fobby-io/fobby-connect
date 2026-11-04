import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// vitest also reads this file; its tests live under test/, so the web root applies only to vite itself.
export default defineConfig(
  process.env.VITEST
    ? {}
    : {
        root: "web/src",
        plugins: [react(), tailwindcss()],
        build: { outDir: "../dist", emptyOutDir: true },
        server: { proxy: { "/api": "http://localhost:8787" } },
      },
);
