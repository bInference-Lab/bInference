import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AmountWire,
  amountSchema,
} from "@binference/chain";
import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import type { RescueRequest } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type DocumentCodec, documentCodec } from "./intent-documents.schema.js";

/**
 * One move of a rescue: an asset, as it is, from a wallet's account to the rescue address. The
 * wallet named signs it.
 */
export interface RescueMove {
  readonly wallet: Id<"wal">;
  readonly from: AccountRef;
  readonly amount: Amount;
}

/**
 * What a rescue's card confirms (decision 0044): where everything goes, each move in the order of
 * the plan's steps, what the moves were worth when quoted, rounded down, and when that was. A
 * rescue keeps it in the intent's `quote` column, so the card's terms hash binds every move.
 */
export interface RescueQuote {
  readonly rescue: AccountRef;
  readonly moves: readonly RescueMove[];
  /** Assets with no USD price count for nothing. */
  readonly valueUsdMicros: bigint;
  readonly quotedAtMs: number;
}

/** A {@link RescueQuote} as JSON carries it. */
interface RescueQuoteWire {
  readonly rescue: string;
  readonly moves: readonly {
    readonly wallet: string;
    readonly from: string;
    readonly amount: AmountWire;
  }[];
  readonly valueUsdMicros: string;
  readonly quotedAtMs: number;
}

const rescueQuoteSchema: z.ZodType<RescueQuote, RescueQuoteWire> = z.strictObject({
  rescue: accountRefSchema,
  moves: z
    .array(
      z.strictObject({ wallet: idSchema("wal"), from: accountRefSchema, amount: amountSchema }),
    )
    .min(1),
  valueUsdMicros: decimalStringSchema,
  quotedAtMs: epochMsSchema,
});

/** A rescue's quote, in the `quote` column of a rescue intent. */
export const rescueQuoteDocument: DocumentCodec<RescueQuote> = documentCodec(
  "rescue quote",
  rescueQuoteSchema,
);

/** The request a rescue stores: only `safety/rescue` makes one, and it asks for nothing more. */
export const rescueRequest: RescueRequest = { kind: "rescue" };
