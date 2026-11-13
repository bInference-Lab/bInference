import { type Id, idSchema } from "@binference/core";
import { communityPluginLimits as limits } from "@binference/protocol";
import { z } from "zod";

/**
 * One plugin listing as the listing catalog signs it (decision 0434): one npm package at one
 * exact version, what its review read of it, and when. Every field but `kind`, `listing`,
 * `version` and `issuedAt` is compared with what an install fetched.
 */
export interface PluginListing {
  readonly kind: "pluginListing";
  readonly listing: Id<"pls">;
  /** Rises each time the catalog signs the listing again after a reviewed change. */
  readonly version: number;
  readonly issuedAt: number;
  readonly packageName: string;
  readonly packageVersion: string;
  /** The tarball's npm integrity, `sha512-` and the base64 digest. */
  readonly integrity: string;
  /** The SHA-256 pin of its files, in hex (decision 0348). */
  readonly files: string;
  /** Its manifest's id. */
  readonly plugin: string;
  readonly provenance: "verified" | "none";
  readonly publisher?: string;
  readonly issuer?: string;
  readonly workflow?: string;
  readonly kinds: readonly string[];
  readonly hosts: readonly string[];
  readonly tools: readonly string[];
  readonly configKeys: readonly string[];
}

/**
 * The listing catalog's revocation list (decision 0435): every plugin listing it revoked so far,
 * with a sequence each new list raises, and the hour at most it is good for.
 */
export interface RevocationList {
  readonly kind: "pluginRevocations";
  readonly sequence: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revoked: readonly Id<"pls">[];
}

const hourMs = 3_600_000;
const maxRevoked = 10_000;
const name = z.string().min(1).max(200);
const epochMs = z.int().nonnegative();

// A list sorted by UTF-16 code units, each entry once, as the review shows it.
function isSortedOnce(list: readonly string[]): boolean {
  return list.every((entry, index) => index === 0 || (list[index - 1] ?? "") < entry);
}

function sortedList(entry: z.ZodString, most: number) {
  return z.array(entry).max(most).refine(isSortedOnce, "Each list is sorted, each entry once.");
}

/** Parses the payload of a {@link PluginListing}; any field it does not name refuses it. */
export const pluginListingSchema: z.ZodType<PluginListing> = z
  .strictObject({
    kind: z.literal("pluginListing"),
    listing: idSchema("pls"),
    version: z.int().positive(),
    issuedAt: epochMs,
    packageName: z.string().min(1).max(214),
    packageVersion: z.string().min(1).max(256),
    integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
    files: z.string().regex(/^[0-9a-f]{64}$/),
    plugin: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    provenance: z.enum(["verified", "none"]),
    publisher: name.exactOptional(),
    issuer: name.exactOptional(),
    workflow: name.exactOptional(),
    kinds: sortedList(z.string().min(1).max(16), 2),
    hosts: sortedList(z.string().min(1).max(limits.hostLength), limits.hosts),
    tools: sortedList(z.string().min(1).max(limits.toolNameLength), limits.tools),
    configKeys: sortedList(z.string().min(1).max(limits.configKeyLength), limits.configKeys),
  })
  .refine(
    (listing) =>
      listing.provenance === "verified" ||
      (listing.issuer === undefined && listing.workflow === undefined),
    "Only a verified listing names an issuer or a workflow.",
  );

/** Parses the payload of a {@link RevocationList}; its life is more than 0 and at most an hour. */
export const revocationListSchema: z.ZodType<RevocationList> = z
  .strictObject({
    kind: z.literal("pluginRevocations"),
    sequence: z.int().positive(),
    issuedAt: epochMs,
    expiresAt: epochMs,
    revoked: z
      .array(idSchema("pls"))
      .max(maxRevoked)
      .refine(isSortedOnce, "The list is sorted, each listing once."),
  })
  .refine(
    (list) => list.expiresAt > list.issuedAt && list.expiresAt - list.issuedAt <= hourMs,
    "A revocation list is good for more than no time and at most an hour.",
  );
