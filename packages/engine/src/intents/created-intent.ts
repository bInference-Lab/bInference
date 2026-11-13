import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type IntentKind, intentKinds } from "./intent-kind.js";
import { type IntentProposerRef, intentProposerRefSchema } from "./intent-record.js";

/** Which intents to read by when they were stored: one agent's, stored at or after `fromMs`. */
export interface CreatedQuery {
  readonly agentId: Id<"agt">;
  readonly fromMs: number;
}

/** Parses a query of intents by when they were stored. */
export const createdQuerySchema: z.ZodType<CreatedQuery> = z.strictObject({
  agentId: idSchema("agt"),
  fromMs: epochMsSchema,
});

/** An intent as a rate quota reads it: what it is, who proposed it and when it was stored. */
export interface CreatedIntent {
  readonly intentId: Id<"int">;
  readonly kind: IntentKind;
  readonly proposer: IntentProposerRef;
  readonly createdAtMs: number;
}

/** Parses an intent as a rate quota reads it. */
export const createdIntentSchema: z.ZodType<CreatedIntent> = z.strictObject({
  intentId: idSchema("int"),
  kind: z.enum(intentKinds),
  proposer: intentProposerRefSchema,
  createdAtMs: epochMsSchema,
});
