import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import type { SendLevel } from "../policy/policy-rules.js";
import { epochMsSchema, rowVersionSchema } from "../records/record-fields.js";

/** Parses a send level: 0 (Open) to 3 (Locked). */
export const sendLevelSchema: z.ZodType<SendLevel, number> = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

/** A looser send level the owner asked for, and when it takes the place of the level now. */
interface PendingSendLevel {
  readonly level: SendLevel;
  /** Epoch milliseconds from which it is the agent's level: 24 hours after it was asked. */
  readonly atMs: number;
}

/**
 * An agent's send level as it was written: the level, and a looser one that waits for its time.
 * A pending level whose time has come is the agent's level, though the row still names it as
 * pending; read the level in effect through `sendLevelAt`.
 */
export interface SendLevelState {
  readonly level: SendLevel;
  readonly pending?: PendingSendLevel;
}

const stateShape = {
  level: sendLevelSchema,
  pending: z.strictObject({ level: sendLevelSchema, atMs: epochMsSchema }).exactOptional(),
};

/** An agent's send level as the store keeps it (database spec, section 2.2, `send_levels`). */
export interface SendLevelRecord extends SendLevelState {
  readonly agentId: Id<"agt">;
  readonly changedAtMs: number;
  readonly version: number;
}

/** Parses a send level record. */
export const sendLevelRecordSchema: z.ZodType<SendLevelRecord> = z.strictObject({
  ...stateShape,
  agentId: idSchema("agt"),
  changedAtMs: epochMsSchema,
  version: rowVersionSchema,
});

/** A new send level state for an agent, under the version the changer read. */
export interface SendLevelChange extends SendLevelState {
  readonly agentId: Id<"agt">;
  readonly atMs: number;
  readonly expectedVersion: number;
}

/** Parses a send level change. */
export const sendLevelChangeSchema: z.ZodType<SendLevelChange> = z.strictObject({
  ...stateShape,
  agentId: idSchema("agt"),
  atMs: epochMsSchema,
  expectedVersion: rowVersionSchema,
});
