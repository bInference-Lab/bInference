import { decimalStringSchema, type Id, idSchema, type Result } from "@binference/core";
import { intentStateSchema } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import type { IntentState } from "./intent-state.js";
import type { LateLanding } from "./late-landing.js";

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
 * stands now, the USD value the policy judged it at when it stores one, and when a dropped step of
 * it landed after all.
 */
export interface ConfirmedIntent {
  readonly intentId: Id<"int">;
  readonly state: IntentState;
  readonly confirmedAtMs: number;
  readonly valueUsdMicros?: bigint;
  /** When a step its drop ended landed after all (decision 0147); absent when none did. */
  readonly landedLateAtMs?: number;
}

/** Parses a confirmed intent. */
export const confirmedIntentSchema: z.ZodType<ConfirmedIntent> = z.strictObject({
  intentId: idSchema("int"),
  state: intentStateSchema,
  confirmedAtMs: epochMsSchema,
  valueUsdMicros: decimalStringSchema.exactOptional(),
  landedLateAtMs: epochMsSchema.exactOptional(),
});

/** The intent store's write of a late landing, which `IntentStore` takes on (decision 0147). */
export interface LandedLate {
  /**
   * Links a late landing to its intent: the intent stays as it is, and `confirmedSince` gives the
   * landing's time with it. An intent that has one already is `exists`, and an unknown intent
   * `not_found`; either writes nothing.
   */
  recordLandedLate(
    landing: LateLanding,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LateLanding, "exists" | "not_found">>;
}
