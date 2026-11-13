import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import { type FilePermissions, readTextFile, writePrivateFile } from "@binference/platform";
import { type CommunityManifest, communityManifestSchema } from "@binference/plugin-sdk/community";
import type { PluginReview } from "@binference/protocol";
import { z } from "zod";
import type { PluginListingRule } from "./plugin-listing-rule.js";
import type { RevocationFloor } from "./revocation-holder.js";

/** Why an installed plugin is off: the owner turned it off, it crashed, or its files changed. */
type PluginOffReason = "owner" | "crashes" | "changed";

/** The plugin listing an installed plugin runs under, on bInference Cloud (decision 0433). */
export interface LockedListing {
  readonly listing: Id<"pls">;
  /** The listing's version the install or an enable last checked; a later check takes no lower. */
  readonly version: number;
  /**
   * Set once a revocation list the engine took names the listing (decision 0435): the plugin is
   * off, beside any reason it was off for before, and never runs again under this listing,
   * whatever a later list says. Only an update to another listing turns it on again.
   */
  readonly revoked?: true;
}

/** One installed community plugin as the plugin lock records it (decision 0348). */
export interface LockedPlugin {
  /** Its `plg_` id, kept across updates. */
  readonly plugin: string;
  /** Its id in its manifest, such as `fear-index`, which names its folders. */
  readonly id: string;
  /** The npm package it came from. */
  readonly packageName: string;
  readonly version: string;
  /** `npm:<name>@<version>`. */
  readonly source: string;
  /** Its tarball's npm integrity, `sha512-` and the base64 digest. */
  readonly integrity: string;
  /** The SHA-256 of its files, which its folder must hash to before each start. */
  readonly hash: string;
  readonly manifest: CommunityManifest;
  /** The digest of the declarations the owner accepted. */
  readonly accepted: string;
  readonly provenance: PluginReview["provenance"];
  /** The source repository its provenance names, else the npm account the registry names. */
  readonly publisher?: string;
  /** The OIDC issuer of its provenance's signing certificate; none without provenance. */
  readonly issuer?: string;
  /** The build workflow its provenance names, when it lives in another repository. */
  readonly workflow?: string;
  readonly enabled: boolean;
  readonly disabledReason?: PluginOffReason;
  readonly installedAt: number;
  /** Its plugin listing, where the composition root needs one; self-hosted entries hold none. */
  readonly listing?: LockedListing;
}

/** The plugin lock, `plugins/lock.json`: the one record of the installed community plugins. */
export interface PluginLock {
  readonly plugins: readonly LockedPlugin[];
  /**
   * The newest revocation list the engine took, where plugins need listings (decision 0435):
   * no older list is taken after a restart. A self-hosted lock holds none.
   */
  readonly revocations?: RevocationFloor;
  /**
   * When the owner was last told that the listed plugins are held for want of a fresh revocation
   * list, in epoch milliseconds, so a restart tells again only after 24 hours (decision 0435).
   */
  readonly heldToldAt?: number;
}

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

// The fields of an entry as self-hosted writes it.
const entryFields = {
  plugin: z.string().regex(/^plg_[0-9a-f-]{36}$/),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  packageName: z.string().min(1).max(214),
  version: z.string().min(1).max(256),
  source: z.string().min(1).max(2048),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  hash: sha256Hex,
  manifest: communityManifestSchema,
  accepted: sha256Hex,
  provenance: z.enum(["verified", "none"]),
  publisher: z.string().max(200).exactOptional(),
  issuer: z.string().max(200).exactOptional(),
  workflow: z.string().max(200).exactOptional(),
  enabled: z.boolean(),
  disabledReason: z.enum(["owner", "crashes", "changed"]).exactOptional(),
  installedAt: z.int().nonnegative(),
};

const listingSchema: z.ZodType<LockedListing> = z.strictObject({
  listing: idSchema("pls"),
  version: z.int().positive(),
  revoked: z.literal(true).exactOptional(),
});

// A plugin's id names its folders, so it holds to the manifest's id pattern and to its manifest.
const sameId = (entry: LockedPlugin): boolean => entry.id === entry.manifest.id;

const ownEntrySchema: z.ZodType<LockedPlugin> = z
  .strictObject(entryFields)
  .refine(sameId, "the id must be its manifest's");

const listedEntrySchema: z.ZodType<LockedPlugin> = z
  .strictObject({ ...entryFields, listing: listingSchema.exactOptional() })
  .refine(sameId, "the id must be its manifest's");

const floorSchema: z.ZodType<RevocationFloor> = z.strictObject({
  sequence: z.int().positive(),
  key: z.string().regex(/^[0-9a-f]{32}$/),
  digest: sha256Hex,
});

// The lock as each rule writes it: under a rule that needs listings, the entries' listings and
// the revocation floor too; elsewhere neither, so a self-hosted lock that holds them does not read.
const lockSchemas = {
  notRequired: z.strictObject({ version: z.literal(1), plugins: z.array(ownEntrySchema) }),
  required: z.strictObject({
    version: z.literal(1),
    plugins: z.array(listedEntrySchema),
    revocations: floorSchema.exactOptional(),
    heldToldAt: z.int().nonnegative().exactOptional(),
  }),
} as const;

/** The empty lock: no plugin installed. */
export const emptyPluginLock: PluginLock = { plugins: [] };

/** Which lock a reader takes: the one its composition root's listing rule writes. */
export type LockForm = PluginListingRule["kind"];

function parsedLock(text: string, form: LockForm): Result<PluginLock, "unreadable"> {
  try {
    if (form === "notRequired") {
      const read = lockSchemas.notRequired.safeParse(JSON.parse(text));
      return read.success ? ok({ plugins: read.data.plugins }) : err("unreadable");
    }
    const read = lockSchemas.required.safeParse(JSON.parse(text));
    if (!read.success) {
      return err("unreadable");
    }
    const { plugins, revocations, heldToldAt } = read.data;
    return ok({
      plugins,
      ...(revocations === undefined ? {} : { revocations }),
      ...(heldToldAt === undefined ? {} : { heldToldAt }),
    });
  } catch {
    return err("unreadable");
  }
}

/**
 * Reads the plugin lock, in the form its composition root's listing rule writes (self-hosted's
 * when none is named). A missing lock holds no plugin; one that does not read is `unreadable`:
 * its plugins are never started rather than trusted, and it is never written over.
 */
export async function readPluginLock(
  file: string,
  signal: AbortSignal,
  form: LockForm = "notRequired",
): Promise<Result<PluginLock, "unreadable">> {
  const read = await readTextFile(file, signal);
  return read.ok ? parsedLock(read.value, form) : ok(emptyPluginLock);
}

/** Writes the plugin lock in place of the one there, owner-only, its plugins in id order. */
export async function writePluginLock(
  file: string,
  lock: PluginLock,
  options: { readonly permissions: FilePermissions; readonly signal: AbortSignal },
): Promise<void> {
  const plugins = lock.plugins.toSorted((a, b) => a.id.localeCompare(b.id));
  const { revocations, heldToldAt } = lock;
  const written = {
    version: 1,
    plugins,
    ...(revocations === undefined ? {} : { revocations }),
    ...(heldToldAt === undefined ? {} : { heldToldAt }),
  };
  const text = `${JSON.stringify(written, undefined, 2)}\n`;
  await writePrivateFile(file, text, options);
}
