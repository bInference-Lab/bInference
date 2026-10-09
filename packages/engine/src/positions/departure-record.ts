import { type Amount, amountSchema, isTxHash, type TxHash } from "@binference/chain";
import { type Id, idSchema, type Result } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, rowNumberSchema } from "../records/record-fields.js";
import { type PositionWrite, positionWriteSchema } from "./position-record.js";

/**
 * Funds one send took out of a live wallet without a trade, such as a rescue's transfer to the
 * rescue address (decision 0127): the units that went to the recipient, and the native coin the
 * send paid for its gas. Both leave their positions at average cost, with no gain or loss.
 */
export interface DepartureDraft {
  readonly walletId: Id<"wal">;
  readonly atMs: number;
  /** What the recipient was sent. */
  readonly sent: Amount;
  /** The chain's native coin the send paid for its gas. */
  readonly gas: Amount;
  /** The transaction that sent it. */
  readonly txHash: TxHash;
}

const draftShape = {
  walletId: idSchema("wal"),
  atMs: epochMsSchema,
  sent: amountSchema,
  gas: amountSchema,
  txHash: z.string().refine(isTxHash),
};

const departureDraftSchema: z.ZodType<DepartureDraft> = z.strictObject(draftShape);

/** A departure as stored: the intent whose send it was, numbered in the order recorded. */
export interface DepartureRecord extends DepartureDraft {
  readonly intentId: Id<"int">;
  readonly id: number;
}

/** Parses a stored departure. */
export const departureRecordSchema: z.ZodType<DepartureRecord> = z.strictObject({
  ...draftShape,
  intentId: idSchema("int"),
  id: rowNumberSchema,
});

/**
 * One intent's departures with the live position changes they make, stored all or nothing and
 * once per intent.
 */
export interface DepartureWrite {
  readonly intentId: Id<"int">;
  readonly departures: readonly DepartureDraft[];
  readonly positions: readonly PositionWrite[];
}

/** Parses a departure write. */
export const departureWriteSchema: z.ZodType<DepartureWrite> = z.strictObject({
  intentId: idSchema("int"),
  departures: z.array(departureDraftSchema).min(1),
  positions: z.array(positionWriteSchema),
});

/** An intent's stored departures with their numbers, or `stale` when a position moved first. */
export type DepartureOutcome = Result<readonly DepartureRecord[], "stale">;
