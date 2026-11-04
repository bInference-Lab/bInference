import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const manifestSchema = z.looseObject({
  name: z.string(),
  main: z.string().optional(),
  bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  exports: z.unknown().optional(),
});

// Each file an `exports` value names, with the subpath and conditions that lead to it. A pattern
// with `*` names no one file, and `null` hides a subpath.
function exportTargets(value: unknown, path: string): readonly [string, string][] {
  if (typeof value === "string") {
    return value.includes("*") ? [] : [[path, value]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => exportTargets(item, path));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      exportTargets(item, path === "" ? `exports["${key}"]` : `${path}["${key}"]`),
    );
  }
  return [];
}

// Every file the manifest says the package holds: its `exports`, `bin` and `main`.
function namedFiles(manifest: z.output<typeof manifestSchema>): readonly [string, string][] {
  const { bin, main } = manifest;
  const bins = typeof bin === "string" ? { [manifest.name]: bin } : (bin ?? {});
  const mains: readonly [string, string][] = main === undefined ? [] : [["main", main]];
  return [
    ...exportTargets(manifest.exports, ""),
    ...Object.entries(bins).map(([name, file]): [string, string] => [`bin["${name}"]`, file]),
    ...mains,
  ];
}

// The workspace packages a published one carries inside it (decision 0352).
function bundledFolders(folder: string): readonly string[] {
  const scope = join(folder, "node_modules", "@binference");
  return existsSync(scope)
    ? readdirSync(scope, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(scope, entry.name))
    : [];
}

function missingIn(folder: string): readonly string[] {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(folder, "package.json"), "utf8")),
  );
  return namedFiles(manifest)
    .filter(([, file]) => !existsSync(join(folder, file)))
    .map(([where, file]) => `${manifest.name}: ${where} names ${file}, which the package lacks.`);
}

/**
 * Checks that every file an installed package's manifest names exists: each target of its
 * `exports` (every condition, types included), its `bin` and its `main`, for each published
 * package in `install`'s `node_modules` and each workspace package it carries. Returns one line
 * per missing file, naming the package, the entry and the file.
 */
export function findMissingEntries(
  install: string,
  packages: readonly string[],
): readonly string[] {
  return packages.flatMap((name) => {
    const folder = join(install, "node_modules", name);
    return [folder, ...bundledFolders(folder)].flatMap((each) => missingIn(each));
  });
}
