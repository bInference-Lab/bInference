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
 * Which live fills of an agent's auto orders and webhook rules hold its line (decisions 0211 and
 * 0342): those the executor holds that their order or alert has not counted, and those whose
 * dropped step is still watched, ended `failed_onchain` with `stuck_dropped` at or after
 * `droppedSinceMs`, with no late landing.
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

const fillAuthorizationShape = z.union([
  z.looseObject({ order: idSchema("ord") }),
  z.looseObject({ webhookRule: idSchema("whr") }),
]);

/** Whether an intent's stored authorization is an auto order's or a webhook rule's. */
export function isFillAuthorized(authorizedBy: JsonValue | undefined): boolean {
  return fillAuthorizationShape.safeParse(authorizedBy).success;
}
