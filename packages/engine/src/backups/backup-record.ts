import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/** Why a backup was taken (database spec, `backups.kind`; keys spec, section 7.3). */
export type BackupKind = "daily" | "weekly" | "manual" | "before_update" | "before_migration";

/** One backup file the install wrote, as the `backups` table keeps it. */
export interface BackupRecord {
  readonly id: Id<"bkp">;
  /** The file's absolute path on this machine. */
  readonly path: string;
  readonly bytes: number;
  readonly kind: BackupKind;
  readonly createdAtMs: number;
  /** When the file was read back and every chunk and file checked; absent until then. */
  readonly verifiedAtMs?: number;
  /**
   * The SHA-256 of the whole file, and of its header line, in hex: a restore on this install
   * knows the file as one it wrote by them (keys spec, section 7.4). Absent on a backup written
   * before the install kept them.
   */
  readonly fileSha256?: string;
  readonly headerSha256?: string;
}

/** Parses a backup kind. */
export const backupKindSchema: z.ZodType<BackupKind> = z.enum([
  "daily",
  "weekly",
  "manual",
  "before_update",
  "before_migration",
]);

/** Parses a backup's id. */
export const backupIdSchema: z.ZodType<Id<"bkp">, string> = idSchema("bkp");

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/u);

/** Parses a backup record as it crosses the store worker's boundary. */
export const backupRecordSchema: z.ZodType<BackupRecord> = z.strictObject({
  id: backupIdSchema,
  path: z.string().min(1),
  bytes: z.int().nonnegative(),
  kind: backupKindSchema,
  createdAtMs: epochMsSchema,
  verifiedAtMs: epochMsSchema.exactOptional(),
  fileSha256: sha256Hex.exactOptional(),
  headerSha256: sha256Hex.exactOptional(),
});

/** A backup marked verified, and when. */
export interface BackupVerified {
  readonly id: Id<"bkp">;
  readonly atMs: number;
}

/** Parses a {@link BackupVerified}. */
export const backupVerifiedSchema: z.ZodType<BackupVerified> = z.strictObject({
  id: backupIdSchema,
  atMs: epochMsSchema,
});
