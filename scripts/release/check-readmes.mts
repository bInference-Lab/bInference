import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTextScanner } from "../style/scan-text.mjs";
import { loadWordLists } from "../style/word-lists.mjs";
import type { PackedFile } from "./pack-release.mjs";
import { readmes } from "./stage-package.mjs";

/**
 * The style guard over each tarball's npm page, as packed: no reserved name, no word the guard
 * refuses, Chinese only in the Chinese page. Returns one line per finding, named by the tarball.
 */
export function packedReadmeFindings(
  root: string,
  out: string,
  files: readonly PackedFile[],
): readonly string[] {
  const scan = createTextScanner(loadWordLists(root));
  return files.flatMap((packed) =>
    readmes.flatMap((readme) => {
      const text = readFileSync(join(out, "stage", packed.name, readme), "utf8");
      return scan(`${packed.file}/${readme}`, text).map(
        (item) => `${item.where}:${String(item.line)}: check:style(${item.rule}): ${item.message}`,
      );
    }),
  );
}
