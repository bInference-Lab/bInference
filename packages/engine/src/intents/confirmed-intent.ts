import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import { intentStateSchema } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import type { IntentState } from "./intent-state.js";

/** Which confirmed intents to read: one agent's, in one mode, confirmed at or after `fromMs`. */
export interface ConfirmedQuery {
  readonly agentId: Id<"agt">;
  readonly isPaper: boolean;
  readonly fromMs: number;
}

/** Parses a query of confirmed intents. */
export const confirmedQuerySchema: z.ZodType<ConfirmedQuery> = z.strictObject({
  agentId: idSchema("agt"),
  isPaper: z.boolean(),
  fromMs: epochMsSchema,
});

/**
 * An intent the owner's tap or the auto mode confirmed: when it moved to `confirmed`, where it
 * stands now, and the USD value the policy judged it at when it stores one.
 */
export interface ConfirmedIntent {
  readonly intentId: Id<"int">;
  readonly state: IntentState;
  readonly confirmedAtMs: number;
  readonly valueUsdMicros?: bigint;
}

/** Parses a confirmed intent. */
export const confirmedIntentSchema: z.ZodType<ConfirmedIntent> = z.strictObject({
  intentId: idSchema("int"),
  state: intentStateSchema,
  confirmedAtMs: epochMsSchema,
  valueUsdMicros: decimalStringSchema.exactOptional(),
});
