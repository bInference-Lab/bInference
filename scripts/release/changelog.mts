import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The changelog for owners, in English and Simplified Chinese, at the repository's root.
const changelogs: readonly string[] = ["CHANGELOG.md", "CHANGELOG.zh.md"];

/**
 * Checks that each changelog holds a `## <version>` heading for a stable or beta release, such as
 * `## 2026.11.0-beta.1`. Returns one problem per file that lacks it, or none.
 */
export function changelogProblems(root: string, version: string): readonly string[] {
  const heading = new RegExp(`^## ${version.replaceAll(".", "\\.")}(?: .*)?$`, "m");
  return changelogs.flatMap((file) => {
    const path = join(root, file);
    if (existsSync(path) && heading.test(readFileSync(path, "utf8"))) {
      return [];
    }
    return [`${file} has no "## ${version}" heading; write the release's entry for owners there.`];
  });
}
