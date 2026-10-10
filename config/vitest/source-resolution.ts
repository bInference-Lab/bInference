import type { ViteUserConfig } from "vitest/config";

// The export conditions tests resolve. Workspace packages give their src under the first one, so
// tests never need a build.
const sourceConditions: readonly string[] = [
  "@binference/source",
  "module",
  "node",
  "development|production",
];

/** How every Vitest config resolves imports: workspace packages to their source, SSR too. */
export const sourceResolution: Pick<ViteUserConfig, "resolve" | "ssr"> = {
  resolve: { conditions: [...sourceConditions] },
  ssr: { resolve: { conditions: [...sourceConditions] } },
};
