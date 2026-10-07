import { amountSchema, type TxDraft, txDraftSchema } from "@binference/chain";
import { BinferenceError, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import {
  type IntentRequest,
  intentRequestSchema,
  type QuoteView,
  quoteViewSchema,
  type SimulationView,
} from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import type { Authorization } from "./authorization.js";

/**
 * Turns one kind of document an intent keeps, such as its quote, into the JSON its store column
 * holds, and back.
 */
export interface DocumentCodec<T> {
  /** The document as JSON, amounts as decimal strings. */
  readonly encode: (value: T) => JsonValue;
  /**
   * Parses a stored document. Only the engine writes these columns, so a document that breaks its
   * schema is a fault: `engine.bad_document`.
   */
  readonly decode: (json: JsonValue) => T;
}

/** Builds the {@link DocumentCodec} of one document kind from its schema. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- zod schemas are mutable
export function documentCodec<T, Wire>(name: string, schema: z.ZodType<T, Wire>): DocumentCodec<T> {
  return {
    encode: (value) => jsonValueSchema.parse(z.encode(schema, value)),
    decode(json) {
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new BinferenceError({
          code: "engine.bad_document",
          message: `A stored ${name} breaks its schema.`,
          details: { document: name },
        });
      }
      return parsed.data;
    },
  };
}

const simulationViewSchema: z.ZodType<SimulationView> = z.strictObject({
  spent: z.array(amountSchema),
  received: z.array(amountSchema),
  simulatedAt: epochMsSchema,
});

const authorizationSchema: z.ZodType<Authorization> = z.union([
  z.strictObject({ order: idSchema("ord") }),
  z.strictObject({ webhookRule: idSchema("whr"), alertId: z.string().min(1) }),
  z.strictObject({ approvalMode: z.literal("auto"), modeVersion: z.int().nonnegative() }),
]);

/** The request as the proposer sent it, in the `request` column. */
export const requestDocument: DocumentCodec<IntentRequest> = documentCodec(
  "request",
  intentRequestSchema,
);

/** The venue's quote as cards and views show it, in the `quote` column. */
export const quoteDocument: DocumentCodec<QuoteView> = documentCodec("quote", quoteViewSchema);

const planSchema: z.ZodType<readonly TxDraft[]> = z.array(txDraftSchema).min(1);

/** The drafts the venue built and the host checked, in order, in the `plan` column. */
export const planDocument: DocumentCodec<readonly TxDraft[]> = documentCodec("plan", planSchema);

/** The wallet's balance changes in the simulation, in the `simulation` column. */
export const simulationDocument: DocumentCodec<SimulationView> = documentCodec(
  "simulation",
  simulationViewSchema,
);

/** The order, webhook rule or auto mode that let the intent skip its card. */
export const authorizationDocument: DocumentCodec<Authorization> = documentCodec(
  "authorization",
  authorizationSchema,
);
