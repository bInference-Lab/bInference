import { type Id, idSchema } from "@binference/core";
import type { UnfreezeRequest } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema, shortTextSchema } from "../records/record-fields.js";
import { type DocumentCodec, documentCodec } from "./intent-documents.schema.js";

/** An agent an unfreeze lifts the freeze of, by its id and the name its card shows. */
export interface UnfrozenAgent {
  readonly agent: Id<"agt">;
  readonly name: string;
}

/**
 * What an unfreeze's card confirms (decision 0128): the agents it unfreezes, whether it lifts the
 * install's freeze too, and when it was read. An unfreeze keeps it in the intent's `quote` column,
 * so the card's terms hash binds every agent it names.
 */
export interface UnfreezeQuote {
  readonly agents: readonly UnfrozenAgent[];
  readonly isWholeInstall: boolean;
  readonly quotedAtMs: number;
}

const unfreezeQuoteSchema: z.ZodType<UnfreezeQuote> = z.strictObject({
  agents: z.array(z.strictObject({ agent: idSchema("agt"), name: shortTextSchema })),
  isWholeInstall: z.boolean(),
  quotedAtMs: epochMsSchema,
});

/** An unfreeze's quote, in the `quote` column of an unfreeze intent. */
export const unfreezeQuoteDocument: DocumentCodec<UnfreezeQuote> = documentCodec(
  "unfreeze quote",
  unfreezeQuoteSchema,
);

const unfreezeRequestSchema: z.ZodType<UnfreezeRequest> = z.strictObject({
  kind: z.literal("unfreeze"),
  agent: idSchema("agt").exactOptional(),
});

/** The request an unfreeze stores: the agent it unfreezes, or none for the whole install. */
export const unfreezeRequestDocument: DocumentCodec<UnfreezeRequest> = documentCodec(
  "unfreeze request",
  unfreezeRequestSchema,
);
