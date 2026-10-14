import { type Id, idSchema, type JsonValue } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import type { IntentState } from "./intent-state.js";

/** The states of a live fill the executor holds: confirmed, then signing, sending and settling. */
export const inFlightStates: readonly IntentState[] = [
  "confirmed",
  "executing",
  "included",
  "finalized",
  "unknown_after_send",
];

/**
 * Which live order fills of an agent hold its line (decision 0211): those the executor holds and
 * whose order has not counted them, and those whose dropped step is still watched, ended
 * `failed_onchain` with `stuck_dropped` at or after `droppedSinceMs`, with no late landing.
 */
export interface FillsInFlightQuery {
  readonly agentId: Id<"agt">;
  readonly droppedSinceMs: number;
}

/** Parses a fills-in-flight query. */
export const fillsInFlightQuerySchema: z.ZodType<FillsInFlightQuery> = z.strictObject({
  agentId: idSchema("agt"),
  droppedSinceMs: epochMsSchema,
});

const orderAuthorizationShape = z.looseObject({ order: idSchema("ord") });

/** Whether an intent's stored authorization is an auto order's. */
export function isOrderAuthorized(authorizedBy: JsonValue | undefined): boolean {
  const parsed = orderAuthorizationShape.safeParse(authorizedBy);
  return parsed.success;
}
