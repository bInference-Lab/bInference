import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";
import { precompress } from "./precompress-plugin";

// The engine serves the build from memory at `/` and `/mini`, so every file is named from the
// root, and workspace packages resolve to their TypeScript source. No asset is inlined as a data:
// URL, which the page's policy refuses. Each text file gets its Brotli and gzip copies.
const outDir = fileURLToPath(new URL("dist", import.meta.url));

const config: UserConfig = defineConfig({
  base: "/",
  plugins: [react(), tailwindcss(), precompress(outDir)],
  resolve: {
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
    conditions: ["@binference/source", "browser", "module", "import", "default"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2023",
    assetsInlineLimit: 0,
  },
});

export default config;
