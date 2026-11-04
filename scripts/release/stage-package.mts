import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  outsideDependencies,
  runtimeClosure,
  type Workspace,
  type WorkspaceEntry,
  type WorkspaceManifest,
} from "./workspace-manifests.mjs";

/** The workspace a release reads and the version it writes into every manifest. */
export interface ReleaseBuild {
  readonly workspace: Workspace;
  readonly version: string;
  /**
   * A nightly pack (decision 0354): each published manifest says `"private": true`, so npm
   * refuses to publish its tarball from anywhere.
   */
  readonly isNightly?: boolean;
}

// The workspace's own build condition points at sources the tarball does not hold.
const sourceCondition = "@binference/source";

// Fields of a workspace manifest that mean nothing in a tarball, or point at the workspace.
const droppedFields = new Set(["private", "scripts", "devDependencies", "dependencies", "files"]);

/** A published package's npm page, in English and Simplified Chinese, from its `npm` folder. */
export const readmes: readonly string[] = ["README.md", "README.zh.md"];

const sharedFiles = new Set(["NOTICES.md", "skills"]);

// What npm and provenance need from a published package's own manifest.
const publishedSchema = z.looseObject({
  private: z.never({ error: 'sets "private"' }).optional(),
  license: z.literal("MIT", { error: "is not MIT" }),
  repository: z.object(
    { type: z.literal("git"), url: z.url(), directory: z.string() },
    { error: "names no repository with its directory" },
  ),
  publishConfig: z.object(
    { access: z.literal("public"), provenance: z.literal(true) },
    { error: "lacks publishConfig with public access and provenance" },
  ),
  engines: z.object({ node: z.literal(">=26.1") }, { error: "lacks engines.node >=26.1" }),
  // npm takes README.md from the tarball's root by itself; the Chinese page must be listed.
  files: z
    .array(z.string())
    .refine((files) => files.includes("NOTICES.md") && files.includes("README.zh.md"), {
      error: "lists no NOTICES.md or README.zh.md in files",
    }),
});

/** Why a published package's own `package.json` is not ready for npm, one line each. */
export function publishProblems(entry: WorkspaceEntry): readonly string[] {
  const result = publishedSchema.safeParse(entry.manifest);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${entry.folder}/package.json ${issue.message}.`);
}

function withoutSource(exports: unknown): unknown {
  if (typeof exports !== "object" || exports === null) {
    return exports;
  }
  return Object.fromEntries(
    Object.entries(exports)
      .filter(([key]) => key !== sourceCondition)
      .map(([key, value]) => [key, withoutSource(value)]),
  );
}

function sorted(versions: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(versions).toSorted(([a], [b]) => a.localeCompare(b)));
}

function manifestFor(
  manifest: WorkspaceManifest,
  version: string,
  dependencies: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const kept = Object.entries(manifest).filter(([key]) => !droppedFields.has(key));
  return {
    ...Object.fromEntries(kept),
    version,
    ...("exports" in manifest ? { exports: withoutSource(manifest["exports"]) } : {}),
    ...(Object.keys(dependencies).length === 0 ? {} : { dependencies: sorted(dependencies) }),
  };
}

// Where a listed file comes from: the package's npm page (its READMEs) from its `npm` folder,
// the notices and the bundled skills from the repository's root, the rest from the package's
// folder. The repository's own README never ships.
function sourceOf(build: ReleaseBuild, entry: WorkspaceEntry, file: string): string {
  const { root } = build.workspace;
  if (readmes.includes(file)) {
    return join(root, entry.folder, "npm", file);
  }
  return sharedFiles.has(file) ? join(root, file) : join(root, entry.folder, file);
}

function copyFiles(build: ReleaseBuild, entry: WorkspaceEntry, into: string): void {
  for (const file of entry.manifest.files ?? []) {
    const from = sourceOf(build, entry, file);
    if (!existsSync(from)) {
      throw new Error(`${entry.folder} lists ${file} in files, and ${from} does not exist.`);
    }
    cpSync(from, join(into, file), { recursive: true, dereference: true });
  }
}

function entryOf(build: ReleaseBuild, name: string): WorkspaceEntry {
  const entry = build.workspace.packages.get(name);
  if (entry === undefined) {
    throw new Error(`${name} is not a workspace package.`);
  }
  return entry;
}

// The workspace packages at the release's version, the outside ones at the catalog's.
function dependenciesOf(build: ReleaseBuild, names: readonly string[]): Record<string, string> {
  const own = names.flatMap((name) =>
    Object.keys(entryOf(build, name).manifest.dependencies ?? {}),
  );
  const inside = own.filter((dependency) => build.workspace.packages.has(dependency));
  const outside = names.flatMap((name) =>
    Object.entries(outsideDependencies(build.workspace, name)),
  );
  return Object.fromEntries([
    ...outside,
    ...inside.map((dependency): [string, string] => [dependency, build.version]),
  ]);
}

// A copy names no dependencies: npm would count each one it names as part of the bundle and
// never fetch it. The published package names them all instead.
function stageBundled(build: ReleaseBuild, name: string, into: string): void {
  const entry = entryOf(build, name);
  mkdirSync(into, { recursive: true });
  copyFiles(build, entry, into);
  const manifest = manifestFor(entry.manifest, build.version, {});
  writeFileSync(join(into, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Lays out a published package for `npm pack` in `into` (decision 0352): its own files, every
 * workspace package it needs at run time copied under `node_modules` and named in
 * `bundleDependencies`, and every outside package any of them needs as a dependency at the
 * catalog's exact version, so npm fetches those and nothing else.
 */
export function stagePackage(build: ReleaseBuild, name: string, into: string): void {
  const entry = entryOf(build, name);
  const bundled = runtimeClosure(build.workspace, name);
  for (const dependency of bundled) {
    stageBundled(build, dependency, join(into, "node_modules", dependency));
  }
  mkdirSync(into, { recursive: true });
  copyFiles(build, entry, into);
  cpSync(join(build.workspace.root, "LICENSE"), join(into, "LICENSE"));
  cpSync(sourceOf(build, entry, "README.md"), join(into, "README.md"));
  const manifest = {
    ...manifestFor(entry.manifest, build.version, dependenciesOf(build, [name, ...bundled])),
    files: entry.manifest.files,
    ...(bundled.length === 0 ? {} : { bundleDependencies: bundled }),
    ...(build.isNightly === true ? { private: true } : {}),
  };
  writeFileSync(join(into, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
