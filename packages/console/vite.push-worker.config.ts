import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite";
import { precompress } from "./precompress-plugin";

// The push worker is a classic script at the root, `/push-worker.js`, whose scope is the whole
// console: one file with nothing to import, built after the page into the same folder.
const config: UserConfig = defineConfig({
  publicDir: false,
  plugins: [precompress(fileURLToPath(new URL("dist", import.meta.url)))],
  resolve: {
    conditions: ["@binference/source", "browser", "module", "import", "default"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    target: "es2023",
    lib: {
      entry: fileURLToPath(new URL("src/push/push-worker.ts", import.meta.url)),
      formats: ["iife"],
      name: "pushWorker",
      fileName: () => "push-worker.js",
    },
  },
});

export default config;
