import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadGraph, packageName } from "../package-graph/graph.mjs";
import type { ReleaseChannel } from "./release-tag.mjs";

/** The published packages, as `config/package-graph.json` marks them, libraries first. */
export function publishedPackages(root: string): readonly string[] {
  const graph = loadGraph(root);
  return Object.entries(graph.packages)
    .filter(([, row]) => row.publish === true)
    .map(([key]) => packageName(graph, key))
    .toSorted(
      (a, b) => Number(a === "binference") - Number(b === "binference") || a.localeCompare(b),
    );
}

/** What a dry run wrote, which the workflow's publish jobs read. */
export interface ReleaseManifest {
  readonly tag: string;
  readonly version: string;
  readonly channel: ReleaseChannel;
  readonly npmTag: string;
  readonly imageTags: readonly string[];
  readonly packages: readonly {
    readonly name: string;
    readonly file: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
  readonly sbom: string;
  readonly notes: string;
}

const manifestSchema = z.object({
  tag: z.string(),
  version: z.string(),
  channel: z.enum(["stable", "beta"]),
  npmTag: z.string(),
  imageTags: z.array(z.string()),
  packages: z.array(
    z.object({ name: z.string(), file: z.string(), bytes: z.number(), sha256: z.string() }),
  ),
  sbom: z.string(),
  notes: z.string(),
}) satisfies z.ZodType<ReleaseManifest>;

/** The file a dry run writes beside its artifacts. */
export const manifestFile = "release.json";

/** Reads the manifest a dry run wrote in `folder`. */
export function readReleaseManifest(folder: string): ReleaseManifest {
  return manifestSchema.parse(JSON.parse(readFileSync(join(folder, manifestFile), "utf8")));
}
