import { type Amount, amountSchema, isTxHash, type TxHash } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import { z } from "zod";
import type { CardClosing } from "../confirmations/card-closing.js";
import { epochMsSchema } from "../records/record-fields.js";
import { type DocumentCodec, documentCodec } from "./intent-documents.schema.js";
import type { IntentProposer } from "./intent-status.js";

/** A paper fill: what a paper intent sold and bought at its confirmed quote, and when. */
export interface PaperFill {
  readonly amountIn: Amount;
  readonly amountOut: Amount;
  readonly atMs: number;
}

/**
 * A live trade as its transactions settled on chain: what left the wallet and what reached it,
 * read from the transactions and their logs, the network fee every step paid, each step's
 * transaction hash in step order, and when it reconciled.
 */
export interface SettledTrade {
  readonly amountIn: Amount;
  readonly amountOut: Amount;
  readonly gas: Amount;
  readonly txHashes: readonly TxHash[];
  readonly atMs: number;
}

/**
 * What the engine reads back from an intent event's cause, beside the trigger: who proposed the
 * intent (on its first event), how a card closed, the paper fill a move recorded, and the live
 * trade the move to `reconciled` recorded.
 */
export interface EventCause {
  readonly proposer?: IntentProposer;
  readonly closing?: CardClosing;
  readonly fill?: PaperFill;
  readonly settled?: SettledTrade;
}

const answererSchema = z.strictObject({
  surface: z.enum(["telegram", "console", "mini", "cli"]),
  by: z.string().min(1),
});

const cardClosingSchema: z.ZodType<CardClosing> = z.union([
  z.strictObject({
    outcome: z.enum(["confirmed", "denied"]),
    answeredBy: answererSchema,
    atMs: epochMsSchema,
  }),
  z.strictObject({ outcome: z.literal("expired"), atMs: epochMsSchema }),
]);

const paperFillSchema: z.ZodType<PaperFill> = z.strictObject({
  amountIn: amountSchema,
  amountOut: amountSchema,
  atMs: epochMsSchema,
});

const settledTradeSchema: z.ZodType<SettledTrade> = z.strictObject({
  amountIn: amountSchema,
  amountOut: amountSchema,
  gas: amountSchema,
  txHashes: z.array(z.string().refine(isTxHash)).min(1),
  atMs: epochMsSchema,
});

// Causes carry more than the engine reads back, such as the trigger and who acted.
const eventCauseSchema: z.ZodType<EventCause> = z.looseObject({
  proposer: z.enum(["agent_runtime", "mcp_client", "owner", "engine"]).exactOptional(),
  closing: cardClosingSchema.exactOptional(),
  fill: paperFillSchema.exactOptional(),
  settled: settledTradeSchema.exactOptional(),
});

/** How a card closed, as an event's cause and its ledger entry keep it. */
export const closingDocument: DocumentCodec<CardClosing> = documentCodec(
  "card closing",
  cardClosingSchema,
);

/** A paper fill, as the event and the ledger entry of `paper_filled` keep it. */
export const paperFillDocument: DocumentCodec<PaperFill> = documentCodec(
  "paper fill",
  paperFillSchema,
);

/** A live trade, as the event and the ledger entry of `reconciled` keep it. */
export const settledTradeDocument: DocumentCodec<SettledTrade> = documentCodec(
  "settled trade",
  settledTradeSchema,
);

const causeDocument: DocumentCodec<EventCause> = documentCodec("event cause", eventCauseSchema);

/** Reads what the engine keeps in an event's cause; a cause that breaks its shape is a fault. */
export function readEventCause(cause: JsonValue): EventCause {
  return causeDocument.decode(cause);
}
