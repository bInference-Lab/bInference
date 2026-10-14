import { decimalStringSchema, type Id, idSchema, type Result } from "@binference/core";
import { intentStateSchema } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import type { FillsInFlightQuery } from "./fills-in-flight.js";
import type { IntentRecord } from "./intent-record.js";
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

/**
 * The intent store's late landings, which `IntentStore` takes on: the write of one (decision
 * 0147), and the live fills that hold their agent's line until they land or their watch ends
 * (decision 0211).
 */
export interface LandedLate {
  /**
   * Every live order fill of an agent that holds its line, the least recently changed first, with
   * no page limit (decision 0211).
   */
  fillsInFlight(
    query: FillsInFlightQuery,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly IntentRecord[]>;
  /**
   * Links a late landing to its intent: the intent stays as it is, and `confirmedSince` gives the
   * landing's time with it. With an order write, the landing's order moves and `filled` row land in
   * the same write, all or nothing (decision 0211). An intent that has a landing already is
   * `exists`, an unknown intent `not_found`, and an order at another version `stale`; each writes
   * nothing. An order write that breaks the fill rules throws `store.constraint`.
   */
  recordLandedLate(
    landing: LateLanding,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LateLanding, "exists" | "not_found" | "stale">>;
}
