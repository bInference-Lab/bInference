import { err, ok, type Result } from "@binference/core";
import { type FilePermissions, readTextFile, writePrivateFile } from "@binference/platform";
import { type CommunityManifest, communityManifestSchema } from "@binference/plugin-sdk/community";
import type { PluginReview } from "@binference/protocol";
import { z } from "zod";

/** Why an installed plugin is off: the owner turned it off, it crashed, or its files changed. */
type PluginOffReason = "owner" | "crashes" | "changed";

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
}

/** The plugin lock, `plugins/lock.json`: the one record of the installed community plugins. */
export interface PluginLock {
  readonly plugins: readonly LockedPlugin[];
}

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

// A plugin's id names its folders, so it holds to the manifest's id pattern and to its manifest.
const lockedSchema: z.ZodType<LockedPlugin> = z
  .strictObject({
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
  })
  .refine((entry) => entry.id === entry.manifest.id, "the id must be its manifest's");

const lockSchema = z.strictObject({ version: z.literal(1), plugins: z.array(lockedSchema) });

/** The empty lock: no plugin installed. */
export const emptyPluginLock: PluginLock = { plugins: [] };

function parsedLock(text: string): Result<PluginLock, "unreadable"> {
  try {
    const read = lockSchema.safeParse(JSON.parse(text));
    return read.success ? ok({ plugins: read.data.plugins }) : err("unreadable");
  } catch {
    return err("unreadable");
  }
}

/**
 * Reads the plugin lock. A missing lock holds no plugin; one that does not read is `unreadable`:
 * its plugins are never started rather than trusted, and it is never written over.
 */
export async function readPluginLock(
  file: string,
  signal: AbortSignal,
): Promise<Result<PluginLock, "unreadable">> {
  const read = await readTextFile(file, signal);
  return read.ok ? parsedLock(read.value) : ok(emptyPluginLock);
}

/** Writes the plugin lock in place of the one there, owner-only, its plugins in id order. */
export async function writePluginLock(
  file: string,
  lock: PluginLock,
  options: { readonly permissions: FilePermissions; readonly signal: AbortSignal },
): Promise<void> {
  const plugins = lock.plugins.toSorted((a, b) => a.id.localeCompare(b.id));
  const text = `${JSON.stringify({ version: 1, plugins }, undefined, 2)}\n`;
  await writePrivateFile(file, text, options);
}
