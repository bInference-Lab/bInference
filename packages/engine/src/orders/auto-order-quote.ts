import { type Id, idSchema } from "@binference/core";
import { type AutoOrderRequest, type OrderRequest, orderRequestSchema } from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * What an auto order's card confirms (decision 0189): the order, its request with every default
 * filled, and whether its position holds another active exit order, which the card then says. The
 * `autoOrder` intent keeps it in its `quote` column, so the card's terms hash binds it.
 */
export interface AutoOrderQuote {
  readonly order: Id<"ord">;
  readonly request: OrderRequest;
  readonly expiresAtMs: number;
  /** Absent: no limit on its fills. */
  readonly maxFills?: number;
  readonly hasLinkedExits: boolean;
  readonly quotedAtMs: number;
}

const autoOrderQuoteSchema: z.ZodType<AutoOrderQuote> = z.strictObject({
  order: idSchema("ord"),
  request: orderRequestSchema,
  expiresAtMs: epochMsSchema,
  maxFills: z.int().min(1).exactOptional(),
  hasLinkedExits: z.boolean(),
  quotedAtMs: epochMsSchema,
});

/** An auto order's quote, in the `quote` column of its `autoOrder` intent. */
export const autoOrderQuoteDocument: DocumentCodec<AutoOrderQuote> = documentCodec(
  "auto order quote",
  autoOrderQuoteSchema,
);

const autoOrderRequestSchema: z.ZodType<AutoOrderRequest> = z.strictObject({
  kind: z.literal("autoOrder"),
  order: idSchema("ord"),
});

/** The request an `autoOrder` intent stores: the order whose card it carries. */
export const autoOrderRequestDocument: DocumentCodec<AutoOrderRequest> = documentCodec(
  "auto order request",
  autoOrderRequestSchema,
);
