import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/** The signature scheme of a console device's key. */
export type DeviceAlg = "ed25519" | "p256";

/** A paired console device: its public key, which verifies its answer to each challenge. */
export interface DeviceRecord {
  readonly id: Id<"dev">;
  readonly label: string;
  readonly alg: DeviceAlg;
  readonly publicKey: string;
  readonly createdAtMs: number;
  readonly lastSeenAtMs?: number;
  readonly revokedAtMs?: number;
}

/** Parses a device record. */
export const deviceRecordSchema: z.ZodType<DeviceRecord> = z.strictObject({
  id: idSchema("dev"),
  label: z.string().min(1).max(64),
  alg: z.enum(["ed25519", "p256"]),
  publicKey: z.string().min(1).max(512),
  createdAtMs: epochMsSchema,
  lastSeenAtMs: epochMsSchema.exactOptional(),
  revokedAtMs: epochMsSchema.exactOptional(),
});
