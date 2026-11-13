// A bundler plugin for tsdown's and Vite's builds alike. Node loads it itself when tsdown reads its
// config, and Node runs no TypeScript it imports by a `.js` name, so it is JavaScript.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

/** The folder beside `dist` that holds each build's record. */
export const bundleRecordFolder = "bundle-record";

function slashed(path) {
  return path.split(sep).join("/");
}

// A chunk holds the code of its modules; an asset, such as a font, is a copy of its source files.
// The bundler's own helpers have ids that start with \0 and live in no package.
function sourcesOf(output, packageFolder) {
  const sources = output.type === "chunk" ? output.moduleIds : (output.originalFileNames ?? []);
  return sources
    .filter((source) => !source.startsWith("\0"))
    .map((source) => slashed(relative(packageFolder, resolve(packageFolder, source))))
    .filter((source) => source.includes("node_modules/"))
    .toSorted((a, b) => a.localeCompare(b));
}

function recordOf(packageFolder, outDir, bundle) {
  const entries = Object.values(bundle).map((output) => [
    slashed(relative(packageFolder, join(outDir, output.fileName))),
    sourcesOf(output, packageFolder),
  ]);
  return Object.fromEntries(entries.toSorted(([a], [b]) => a.localeCompare(b)));
}

// Named after the build's first entry, which no other build of the package writes.
function recordName(bundle) {
  const entries = Object.values(bundle).filter(
    (output) => output.type === "chunk" && output.isEntry,
  );
  const [first] = entries.map((chunk) => chunk.name).toSorted((a, b) => a.localeCompare(b));
  return first;
}

export function bundleRecord() {
  let packageFolder = process.cwd();
  return {
    name: "binference-bundle-record",
    buildStart(options) {
      packageFolder = options.cwd ?? packageFolder;
    },
    writeBundle(options, bundle) {
      const name = recordName(bundle);
      if (name === undefined) {
        return;
      }
      const outDir = resolve(packageFolder, options.dir ?? "dist");
      const record = join(packageFolder, bundleRecordFolder, `${name}.json`);
      mkdirSync(dirname(record), { recursive: true });
      const files = recordOf(packageFolder, outDir, bundle);
      writeFileSync(record, `${JSON.stringify({ files }, null, 2)}\n`);
    },
  };
}
