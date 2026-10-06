import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const rowSchema = z.strictObject({
  name: z.string().optional().describe("The npm name, when it is not <scope>/<folder>."),
  imports: z
    .array(z.string())
    .describe("Workspace packages and libraries it may import; * is all."),
  only: z
    .record(z.string(), z.string())
    .optional()
    .describe("A library allowed only inside one folder of the package, such as src/providers."),
  pure: z.boolean().optional().describe("No I/O, no clock, no randomness, no process."),
  money: z.boolean().optional().describe("Money stays bigint: no Number, parseFloat or toFixed."),
  osLayer: z.boolean().optional().describe("May branch on the operating system."),
  fileSystem: z.boolean().optional().describe("May import node:fs."),
  httpListener: z.boolean().optional().describe("May import node:http for its listener."),
  formatsDisplay: z.boolean().optional().describe("May use Intl and locale formatting."),
  userText: z.boolean().optional().describe("Shows text to people, so never error.message."),
  browser: z.boolean().optional().describe("Runs in a browser, so zod/mini instead of zod."),
  compositionRoot: z.boolean().optional().describe("Reads the environment and wires adapters."),
  publish: z.boolean().optional().describe("Published to npm; every other package is private."),
  coverage: z.number().int().min(0).max(100).optional().describe("Line and branch bar, in %."),
});

/** One row of the package graph: what a package may import and which rules bind it. */
export type PackageRow = z.infer<typeof rowSchema>;

const graphSchema = z.strictObject({
  scope: z.string().startsWith("@"),
  allowEverywhere: z.array(z.string()),
  packages: z.record(z.string(), rowSchema),
  plugins: rowSchema.extend({ anyThirdParty: z.boolean().optional() }),
});

/** The package graph in config/package-graph.json. */
export type PackageGraph = z.infer<typeof graphSchema>;

/** A workspace package found on disk. */
export interface WorkspacePackage {
  /** The folder, relative to the repo root, with forward slashes. */
  readonly folder: string;
  /** The graph row key: the folder name, or "plugins" for every plugin. */
  readonly key: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

/** The path of the package graph, relative to the repo root. */
export const graphPath = "config/package-graph.json";

/** Reads and validates the package graph. */
export function loadGraph(repo: string): PackageGraph {
  return graphSchema.parse(JSON.parse(readFileSync(join(repo, graphPath), "utf8")));
}

function listFolders(repo: string, parent: string): readonly string[] {
  const root = join(repo, parent);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "package.json")))
    .map((entry) => entry.name)
    .toSorted();
}

const manifestSchema = z.record(z.string(), z.unknown());

function readManifest(repo: string, folder: string): Readonly<Record<string, unknown>> {
  return manifestSchema.parse(JSON.parse(readFileSync(join(repo, folder, "package.json"), "utf8")));
}

/** Finds every package under packages/ and plugins/. */
export function findPackages(repo: string): readonly WorkspacePackage[] {
  const found = (parent: string, key: (name: string) => string): WorkspacePackage[] =>
    listFolders(repo, parent).map((name) => {
      const folder = `${parent}/${name}`;
      return { folder, key: key(name), manifest: readManifest(repo, folder) };
    });
  return [...found("packages", (name) => name), ...found("plugins", () => "plugins")];
}

/** The npm name a package in the graph must carry. */
export function packageName(graph: PackageGraph, key: string): string {
  return graph.packages[key]?.name ?? `${graph.scope}/${key}`;
}
