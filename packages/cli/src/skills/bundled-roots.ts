import { fileURLToPath } from "node:url";

/**
 * The folders the package's own `skills/` may be in, nearest first: beside `dist/` once packed,
 * the repo's from a build in the repo, and the repo's from the TypeScript source.
 */
export const bundledSkillRoots: readonly string[] = [
  "../skills",
  "../../../skills",
  "../../../../skills",
].map((folder) => fileURLToPath(new URL(folder, import.meta.url)));
