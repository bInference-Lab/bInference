import { type Amount, amountSchema, isTxHash, type TxHash } from "@binference/chain";
import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, pageLimitSchema, rowNumberSchema } from "../records/record-fields.js";
import type { RowPage } from "../records/row-page.js";

/**
 * One trade as it settled on chain, or as it filled on paper, valued in USD at the time. Positions
 * and the CSV export are built from executions alone.
 */
export interface ExecutionDraft {
  readonly intentId: Id<"int">;
  readonly walletId: Id<"wal">;
  readonly isPaper: boolean;
  readonly atMs: number;
  /** What the trade took from the wallet, the fee not included. */
  readonly sold: Amount;
  /** The venue's fee in base units of the sold token, paid on top of `sold`; 0 for none. */
  readonly feeBase: bigint;
  /** What reached the wallet, after any cut the venue or the token kept. */
  readonly bought: Amount;
  /** The network fee in the chain's native coin; 0 base units for a paper fill that paid none. */
  readonly gas: Amount;
  /** The transaction that settled the trade; absent on paper. */
  readonly txHash?: TxHash;
  /** `sold` in micro-dollars at the time. */
  readonly valueUsdMicros: bigint;
  /** The fee in micro-dollars at the time. */
  readonly feeUsdMicros: bigint;
  /** The gas in micro-dollars at the time. */
  readonly gasUsdMicros: bigint;
}

const draftShape = {
  intentId: idSchema("int"),
  walletId: idSchema("wal"),
  isPaper: z.boolean(),
  atMs: epochMsSchema,
  sold: amountSchema,
  feeBase: decimalStringSchema,
  bought: amountSchema,
  gas: amountSchema,
  txHash: z.string().refine(isTxHash).exactOptional(),
  valueUsdMicros: decimalStringSchema,
  feeUsdMicros: decimalStringSchema,
  gasUsdMicros: decimalStringSchema,
};

/** Parses an execution draft. */
export const executionDraftSchema: z.ZodType<ExecutionDraft> = z.strictObject(draftShape);

/** An execution as stored, numbered in the order it was recorded. */
export interface ExecutionRecord extends ExecutionDraft {
  readonly id: number;
}

/** Parses a stored execution. */
export const executionRecordSchema: z.ZodType<ExecutionRecord> = z.strictObject({
  ...draftShape,
  id: rowNumberSchema,
});

/**
 * Which executions to list: paper or live, numbered after `after`, at most `limit`, optionally of
 * one wallet and from `fromMs` up to and including `toMs`.
 */
export interface ExecutionQuery extends RowPage {
  readonly isPaper: boolean;
  readonly walletId?: Id<"wal">;
  readonly fromMs?: number;
  readonly toMs?: number;
}

/** Parses an execution query. */
export const executionQuerySchema: z.ZodType<ExecutionQuery> = z.strictObject({
  after: z.int().nonnegative(),
  limit: pageLimitSchema,
  isPaper: z.boolean(),
  walletId: idSchema("wal").exactOptional(),
  fromMs: epochMsSchema.exactOptional(),
  toMs: epochMsSchema.exactOptional(),
});
