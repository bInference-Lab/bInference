import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import process from "node:process";
import { z } from "zod";
import { listRepoFiles } from "./repo-files.mjs";
import { entryProblems } from "./tsdoc/reachable-exports.mjs";

const manifestSchema = z.looseObject({
  exports: z
    .union([
      z.string(),
      z.record(z.string(), z.union([z.string(), z.record(z.string(), z.unknown())])),
    ])
    .optional(),
});

// An entry is a TypeScript source path in the exports map: a plain string or a condition's value,
// such as the "@binference/source" condition.
function sourcePaths(exports: z.infer<typeof manifestSchema>["exports"]): readonly string[] {
  if (exports === undefined) {
    return [];
  }
  const values = typeof exports === "string" ? [exports] : Object.values(exports);
  return values
    .flatMap((value) => (typeof value === "string" ? [value] : Object.values(value)))
    .filter(
      (value): value is string =>
        typeof value === "string" && /\.m?ts$/.test(value) && !value.endsWith(".d.ts"),
    );
}

function entriesOf(files: ReadonlySet<string>, manifest: string): readonly string[] {
  const folder = posix.dirname(manifest);
  const parsed = manifestSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), manifest), "utf8")),
  );
  const declared = sourcePaths(parsed.exports).map((path) => posix.join(folder, path));
  const index = posix.join(folder, "src", "index.ts");
  return [...new Set([...(files.has(index) ? [index] : []), ...declared])].filter((file) =>
    files.has(file),
  );
}

const files = listRepoFiles(process.cwd());
const present = new Set(files);
const manifests = files.filter((file) => /^(?:packages|plugins)\/[^/]+\/package\.json$/.test(file));
const entries = manifests.flatMap((manifest) => entriesOf(present, manifest));
// An export two entries reach is reported once, at its declaration.
const problems = [
  ...new Map(
    entries
      .flatMap((entry) => entryProblems(process.cwd(), entry))
      .map((item) => [item.where, item]),
  ).values(),
];
for (const item of problems) {
  console.error(`${item.where}: check:tsdoc: ${item.message}`);
}
if (problems.length === 0) {
  console.log(
    `check:tsdoc: ${String(entries.length)} entries in ${String(manifests.length)} packages, every export documented.`,
  );
}
process.exitCode = problems.length === 0 ? 0 : 1;
