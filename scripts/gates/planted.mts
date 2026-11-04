import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Plants each replacement in a real file of the repo. When a file moves on, the anchor is gone
 * and this throws, so a case never passes by planting nothing.
 */
export function planted(
  repo: string,
  file: string,
  replacements: readonly (readonly [string, string])[],
): Record<string, string> {
  const text = readFileSync(join(repo, file), "utf8");
  const missing = replacements.find(([anchor]) => !text.includes(anchor));
  if (missing !== undefined) {
    throw new Error(`${file} no longer holds ${missing[0]}.`);
  }
  return {
    [file]: replacements.reduce((current, [anchor, next]) => current.replace(anchor, next), text),
  };
}
