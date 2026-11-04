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

/**
 * What a nightly pack wrote (decision 0354): its version and tarballs, on the `nightly` channel,
 * which no publish takes.
 */
export interface NightlyManifest {
  readonly version: string;
  readonly channel: "nightly";
  readonly packages: ReleaseManifest["packages"];
}

/** What the built-package smoke reads from a dry run's or a nightly pack's manifest. */
export interface PackedManifest {
  readonly version: string;
  readonly packages: readonly { readonly name: string; readonly file: string }[];
}

const packedManifestSchema = z.looseObject({
  version: z.string(),
  packages: z.array(z.looseObject({ name: z.string(), file: z.string() })),
}) satisfies z.ZodType<PackedManifest>;

/** The file a dry run writes beside its artifacts. */
export const manifestFile = "release.json";

/** Reads the version and tarballs of the manifest a dry run or a nightly pack wrote in `folder`. */
export function readPackedManifest(folder: string): PackedManifest {
  return packedManifestSchema.parse(JSON.parse(readFileSync(join(folder, manifestFile), "utf8")));
}
