import { type Id, idSchema } from "@binference/core";
import { type BackupKind, backupKindSchema } from "@binference/engine/backups";
import { z } from "zod";

/**
 * A backup file's first line (keys spec, section 7.2): what the file is, and what opens it. The
 * nonce prefix and the wrapped key are base64; the wrapped key is the HPKE encapsulated key, 65
 * bytes, then the sealed data key, 48 bytes.
 */
/**
 * A backup file's format version: 2 seals the data key to the owner key itself, 3 to the sealing
 * key the owner key derives (keys spec, section 7.2). Both open; new backups are 3 once the
 * install keeps the sealing key.
 */
export type BackupVersion = 2 | 3;

export interface BackupHeader {
  readonly format: "binference-backup";
  readonly version: BackupVersion;
  readonly installId: Id<"ins">;
  /** When the backup was taken, in epoch milliseconds. */
  readonly createdAt: number;
  readonly kind: BackupKind;
  readonly binferenceVersion: string;
  readonly cipher: "aes-256-gcm-stream";
  readonly chunkBytes: 65_536;
  readonly noncePrefix: string;
  readonly wrappedKey: string;
}

const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Parses a backup header line's JSON; unknown keys are refused. */
export const backupHeaderSchema: z.ZodType<BackupHeader> = z.strictObject({
  format: z.literal("binference-backup"),
  version: z.union([z.literal(2), z.literal(3)]),
  installId: idSchema("ins"),
  createdAt: z.int().nonnegative(),
  kind: backupKindSchema,
  binferenceVersion: z.string().min(1).max(64),
  cipher: z.literal("aes-256-gcm-stream"),
  chunkBytes: z.literal(65_536),
  noncePrefix: z.string().regex(base64).length(12),
  wrappedKey: z.string().regex(base64).length(152),
});

/** Reads only what says a line is a backup header, and of which version. */
export const backupFormatSchema: z.ZodType<{ readonly format: string; readonly version: number }> =
  z.looseObject({ format: z.literal("binference-backup"), version: z.int().positive() });
