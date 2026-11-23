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
};

export default config;
