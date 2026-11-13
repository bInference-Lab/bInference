import { z } from "zod";
import { communityPluginLimits as limits } from "./community-plugin-limits.js";
import { type PluginListingRef, pluginListingRefSchema } from "./plugin-listing.schema.js";

/** What a community plugin declares, each list sorted: what its permission review shows. */
interface PluginDeclarations {
  readonly kinds: readonly string[];
  readonly hosts: readonly string[];
  /** Its tools' names, as its manifest names them. */
  readonly tools: readonly string[];
  /** The top-level keys of its config schema, `plugins.<id>.<key>` in `config.json5`. */
  readonly configKeys: readonly string[];
}

/** Whether npm provenance backs a plugin's version (decision 0348). */
export type PluginProvenance = "verified" | "none";

/**
 * What an update asks beyond the version installed (decision 0348): the version it widens, what
 * it declares beyond it, a publisher other than the installed one's (`from` and `to`, either
 * absent when npm names none), the npm provenance it lost, and whether it is older.
 */
interface PluginWidening {
  readonly from: string;
  readonly added: PluginDeclarations;
  readonly publisher?: { readonly from?: string; readonly to?: string };
  readonly lostProvenance?: true;
  readonly older?: true;
}

/**
 * The permission review of `plugin/add` (protocol spec, section 7.8; decision 0348): the plugin
 * by its id, its version and source, the SHA-256 of its files it is pinned to, its publisher (the
 * source repository its provenance names, else npm's account) and provenance, the build workflow
 * when it lives in another repository, what it declares, and `digest`, the SHA-256 of the package,
 * version, integrity, pin and declarations, which the owner accepts. An update that asks for more
 * names what it widens. Every list holds every entry: the limits keep the whole review short.
 */
export interface PluginReview extends PluginDeclarations {
  readonly plugin: string;
  readonly version: string;
  readonly source: string;
  readonly hash: string;
  readonly publisher?: string;
  readonly workflow?: string;
  readonly provenance: PluginProvenance;
  readonly digest: string;
  readonly widens?: PluginWidening;
  /** The listing it installs under, where one is needed; its `digest` does not hash it. */
  readonly listing?: PluginListingRef;
}

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

const publisherName = z.string().min(1).max(200);

const declarationFields = {
  kinds: z.array(z.enum(["data", "skills"])).max(2),
  hosts: z.array(z.string().max(limits.hostLength)).max(limits.hosts),
  tools: z.array(z.string().max(limits.toolNameLength)).max(limits.tools),
  configKeys: z.array(z.string().max(limits.configKeyLength)).max(limits.configKeys),
};

const pluginDeclarationsSchema: z.ZodType<PluginDeclarations> = z.object(declarationFields);

const wideningSchema: z.ZodType<PluginWidening> = z.object({
  from: z.string().min(1).max(256),
  added: pluginDeclarationsSchema,
  publisher: z
    .object({ from: publisherName.exactOptional(), to: publisherName.exactOptional() })
    .exactOptional(),
  lostProvenance: z.literal(true).exactOptional(),
  older: z.literal(true).exactOptional(),
});

/** Parses a {@link PluginReview}, as the details of `plugin.review_needed` carry it. */
export const pluginReviewSchema: z.ZodType<PluginReview> = z.object({
  plugin: z.string().min(1).max(64),
  version: z.string().min(1).max(256),
  source: z.string().min(1).max(2048),
  hash: sha256Hex,
  publisher: publisherName.exactOptional(),
  workflow: publisherName.exactOptional(),
  provenance: z.enum(["verified", "none"]),
  ...declarationFields,
  digest: sha256Hex,
  widens: wideningSchema.exactOptional(),
  listing: pluginListingRefSchema.exactOptional(),
});
