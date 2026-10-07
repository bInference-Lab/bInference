import { type Amount, amountSchema, isTxHash, type TxHash } from "@binference/chain";
import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, rowNumberSchema } from "../records/record-fields.js";
import { type PositionWrite, positionWriteSchema } from "./position-record.js";

/**
 * Funds that reached a wallet without a trade, such as a deposit or a paper starting balance,
 * valued in USD when they arrived. A valued arrival opens or adds to the position at that value,
 * so a later sale realizes a real gain or loss.
 */
export interface ArrivalDraft {
  readonly walletId: Id<"wal">;
  readonly isPaper: boolean;
  readonly atMs: number;
  /** What arrived. */
  readonly received: Amount;
  /** The transaction that brought the funds; absent on paper. */
  readonly txHash?: TxHash;
  /**
   * `received` in micro-dollars when it arrived. Absent when no usable price was known then: the
   * units stay out of the position, and a later sale of them counts no gain or loss.
   */
  readonly valueUsdMicros?: bigint;
}

const draftShape = {
  walletId: idSchema("wal"),
  isPaper: z.boolean(),
  atMs: epochMsSchema,
  received: amountSchema,
  txHash: z.string().refine(isTxHash).exactOptional(),
  valueUsdMicros: decimalStringSchema.exactOptional(),
};

const arrivalDraftSchema: z.ZodType<ArrivalDraft> = z.strictObject(draftShape);

/** An arrival as stored, numbered in the order it was recorded. */
export interface ArrivalRecord extends ArrivalDraft {
  readonly id: number;
}

/** Parses a stored arrival. */
export const arrivalRecordSchema: z.ZodType<ArrivalRecord> = z.strictObject({
  ...draftShape,
  id: rowNumberSchema,
});

/** An arrival with the position change it makes, stored all or nothing. */
export interface ArrivalWrite {
  readonly arrival: ArrivalDraft;
  readonly positions: readonly PositionWrite[];
}

/** Parses an arrival write. */
export const arrivalWriteSchema: z.ZodType<ArrivalWrite> = z.strictObject({
  arrival: arrivalDraftSchema,
  positions: z.array(positionWriteSchema),
});

/**
 * A wallet's paper portfolio started again, stored all or nothing: the starting balances as paper
 * arrivals of the wallet, and every paper position of the wallet as the reset leaves it, those it
 * empties and those the arrivals open.
 */
export interface PaperReset {
  readonly walletId: Id<"wal">;
  readonly arrivals: readonly ArrivalDraft[];
  readonly positions: readonly PositionWrite[];
}

/** Parses a paper reset. */
export const paperResetSchema: z.ZodType<PaperReset> = z.strictObject({
  walletId: idSchema("wal"),
  arrivals: z.array(arrivalDraftSchema),
  positions: z.array(positionWriteSchema),
});
