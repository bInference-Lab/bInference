import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * A backup file, as `backup/list` lists it and a `backup/create` job ends with it: its id, why it
 * was taken, its size in bytes, when it was taken, and when it was read back and checked.
 */
export interface BackupView {
  readonly backup: ProtocolId<"backup">;
  readonly kind: "daily" | "weekly" | "manual" | "before_update" | "before_migration";
  readonly bytes: number;
  readonly createdAt: number;
  readonly verifiedAt?: number;
}

/** Parses a {@link BackupView}. */
export const backupViewSchema: z.ZodType<BackupView> = z.object({
  backup: protocolIdSchema("backup"),
  kind: z.enum(["daily", "weekly", "manual", "before_update", "before_migration"]),
  bytes: z.int().nonnegative(),
  createdAt: epochMsSchema,
  verifiedAt: epochMsSchema.exactOptional(),
});
