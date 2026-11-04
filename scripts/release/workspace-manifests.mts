import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/** A workspace package's `package.json`, with the fields the release reads checked. */
export interface WorkspaceManifest {
  readonly name: string;
  readonly version: string;
  readonly files?: readonly string[] | undefined;
  readonly dependencies?: Readonly<Record<string, string>> | undefined;
  readonly [field: string]: unknown;
}

const versionsSchema = z.record(z.string(), z.string());

const manifestSchema = z.looseObject({
  name: z.string(),
  version: z.string(),
  files: z.array(z.string()).optional(),
  dependencies: versionsSchema.optional(),
}) satisfies z.ZodType<WorkspaceManifest>;

/** A workspace package: its folder from the repo root and its manifest. */
export interface WorkspaceEntry {
  readonly folder: string;
  readonly manifest: WorkspaceManifest;
}

/** Every workspace package by name, and the catalog's version of each outside package. */
export interface Workspace {
  readonly root: string;
  readonly packages: ReadonlyMap<string, WorkspaceEntry>;
  readonly catalog: Readonly<Record<string, string>>;
}

const catalogSchema = z.looseObject({ catalog: versionsSchema });

function entriesUnder(root: string, parent: string): readonly WorkspaceEntry[] {
  const folder = join(root, parent);
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, "package.json")))
    .map((entry) => {
      const relative = `${parent}/${entry.name}`;
      const text = readFileSync(join(root, relative, "package.json"), "utf8");
      return { folder: relative, manifest: manifestSchema.parse(JSON.parse(text)) };
    });
}

/** Reads the workspace's packages and its catalog. */
export function readWorkspace(root: string): Workspace {
  const entries = [...entriesUnder(root, "packages"), ...entriesUnder(root, "plugins")];
  const settings = catalogSchema.parse(
    parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")),
  );
  return {
    root,
    packages: new Map(entries.map((entry) => [entry.manifest.name, entry])),
    catalog: settings.catalog,
  };
}

/**
 * The workspace packages `name` needs at run time, directly or through each other: the names in
 * the `dependencies` of each, never `devDependencies`.
 */
export function runtimeClosure(workspace: Workspace, name: string): readonly string[] {
  const found = new Set<string>();
  const visit = (current: string): void => {
    const deps = workspace.packages.get(current)?.manifest.dependencies ?? {};
    for (const dependency of Object.keys(deps)) {
      if (workspace.packages.has(dependency) && !found.has(dependency)) {
        found.add(dependency);
        visit(dependency);
      }
    }
  };
  visit(name);
  found.delete(name);
  return [...found].toSorted();
}

/**
 * The outside packages a workspace package needs at run time, at the catalog's exact version.
 * Throws when one is neither in the catalog nor written as an exact version.
 */
export function outsideDependencies(
  workspace: Workspace,
  name: string,
): Readonly<Record<string, string>> {
  const deps = workspace.packages.get(name)?.manifest.dependencies ?? {};
  const outside = Object.entries(deps).filter(
    ([dependency]) => !workspace.packages.has(dependency),
  );
  return Object.fromEntries(
    outside.map(([dependency, range]) => {
      const version = range === "catalog:" ? workspace.catalog[dependency] : range;
      if (version === undefined || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
        throw new Error(`${name} depends on ${dependency} at ${range}, not an exact version.`);
      }
      return [dependency, version];
    }),
  );
}
