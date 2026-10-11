import { type Id, idSchema } from "@binference/core";
import { z } from "zod";

/** One file of a backup's archive: its path inside it, its size, and its SHA-256 in hex. */
export interface ManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * `manifest.json`, the last file of a backup's archive (keys spec, section 7.1): the binference
 * that took it, the schema version of each database it holds and of `config.json5`, the Privy app
 * and the install's live wallets as Privy names them, and every other file with its SHA-256.
 * `agent` is absent when the install had no `agent.sqlite` yet.
 */
export interface BackupManifest {
  readonly format: "binference-backup-manifest";
  readonly version: 1;
  readonly binferenceVersion: string;
  readonly installId: Id<"ins">;
  readonly createdAt: number;
  readonly schemaVersions: {
    readonly engine: number;
    readonly agent?: number;
    readonly config: number;
  };
  readonly privy: { readonly appId: string; readonly wallets: readonly string[] };
  readonly files: readonly ManifestFile[];
}

const version = z.int().positive();

/** Parses `manifest.json`; unknown keys are refused. */
export const backupManifestSchema: z.ZodType<BackupManifest> = z.strictObject({
  format: z.literal("binference-backup-manifest"),
  version: z.literal(1),
  binferenceVersion: z.string().min(1).max(64),
  installId: idSchema("ins"),
  createdAt: z.int().nonnegative(),
  schemaVersions: z.strictObject({
    engine: version,
    agent: version.exactOptional(),
    config: version,
  }),
  privy: z.strictObject({
    appId: z.string().min(1).max(200),
    wallets: z.array(z.string().min(1).max(200)).max(2_000).readonly(),
  }),
  files: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(4_096),
        bytes: z.int().nonnegative(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      }),
    )
    .max(100_000)
    .readonly(),
});
