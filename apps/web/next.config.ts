import { join } from "node:path";
import type { NextConfig } from "next";

/** The agent's landing site: static pages, no server code at request time. */
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The agent's status pill sits bottom left; the dev badge keeps out of its way.
  devIndicators: { position: "bottom-right" },
  // The site's words live in packages/i18n, outside this folder: Turbopack resolves from the root.
  turbopack: { root: join(import.meta.dirname, "..", "..") },
  // The styles arrive inside the page, so a first visit on a slow network renders without
  // waiting on two stylesheet requests; they are small, and the site is one page per language.
  experimental: { inlineCss: true },
  // `pnpm typecheck` checks this app with TypeScript 7 and the repo's strict settings.
  typescript: { ignoreBuildErrors: true },
  // The install script and its sum are read by a shell and by PowerShell: plain text in UTF-8,
  // so neither runs or garbles them (decision 0466).
  headers: async () =>
    ["/install.sh", "/install.sh.sha256"].map((source) => ({
      source,
      headers: [
        { key: "Content-Type", value: "text/plain; charset=utf-8" },
        { key: "Cache-Control", value: "public, max-age=300" },
      ],
    })),
};

export default config;
