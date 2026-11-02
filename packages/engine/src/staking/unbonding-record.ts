import { type AccountRef, accountRefSchema, type Amount, amountSchema } from "@binference/chain";
import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, rowNumberSchema, shortTextSchema } from "../records/record-fields.js";

/**
 * Coin an unstake took out of a stake, as its reconciliation or its paper fill stores it
 * (database spec, `stake_unbondings`): the venue's own id of the request, the coin and what the
 * unstake recorded it worth, and when a claim can take it. The wallet does not hold it yet, so no
 * position counts it until a claim takes it.
 */
export interface UnbondingDraft {
  /** The unstake. */
  readonly intentId: Id<"int">;
  readonly walletId: Id<"wal">;
  readonly venue: string;
  /** The validator of a venue that names one. */
  readonly validator?: AccountRef;
  /** The venue's own id of the request, unique for the venue and the wallet. */
  readonly requestRef: string;
  /** In the chain's coin. */
  readonly amount: Amount;
  /** What the unstake recorded the coin worth, when it had a price. */
  readonly valueUsdMicros?: bigint;
  readonly readyAtMs: number;
  readonly isPaper: boolean;
}

/** An unbonding as the store keeps it, with the claim that took it once one did. */
export interface UnbondingRecord extends UnbondingDraft {
  readonly id: number;
  readonly claimIntentId?: Id<"int">;
  readonly claimedAtMs?: number;
  /** When the owner was told its coin can be claimed (`notice.claimReady`). */
  readonly toldReadyAtMs?: number;
}

/** The unbondings no claim took that are ready at a time, at most `limit` of them. */
export interface UnbondingReadyQuery {
  readonly nowMs: number;
  readonly limit: number;
}

/** The unbondings the owner was told are ready, and when. */
export interface UnbondingTold {
  readonly ids: readonly number[];
  readonly atMs: number;
}

/** One wallet's unbondings in one mode, of every venue and validator. */
export interface UnbondingWalletQuery {
  readonly walletId: Id<"wal">;
  readonly isPaper: boolean;
}

/** Which unbondings a claim may take: one wallet's of one venue and validator, in one mode. */
export interface UnbondingQuery extends UnbondingWalletQuery {
  readonly venue: string;
  readonly validator?: AccountRef;
}

/** A claim's take of unbondings, by the venue's ids of their requests, at a time. */
export interface UnbondingClaim extends UnbondingQuery {
  readonly claimIntentId: Id<"int">;
  readonly requestRefs: readonly string[];
  readonly atMs: number;
}

const requestRefSchema = z.string().min(1).max(200);

const queryShape = {
  walletId: idSchema("wal"),
  isPaper: z.boolean(),
  venue: shortTextSchema,
  validator: accountRefSchema.exactOptional(),
};

const draftShape = {
  intentId: idSchema("int"),
  walletId: idSchema("wal"),
  venue: shortTextSchema,
  validator: accountRefSchema.exactOptional(),
  requestRef: requestRefSchema,
  amount: amountSchema,
  valueUsdMicros: decimalStringSchema.exactOptional(),
  readyAtMs: epochMsSchema,
  isPaper: z.boolean(),
};

/** Parses an unbonding draft. */
export const unbondingDraftSchema: z.ZodType<UnbondingDraft> = z.strictObject(draftShape);

/** Parses a stored unbonding. */
export const unbondingRecordSchema: z.ZodType<UnbondingRecord> = z.strictObject({
  ...draftShape,
  id: rowNumberSchema,
  claimIntentId: idSchema("int").exactOptional(),
  claimedAtMs: epochMsSchema.exactOptional(),
  toldReadyAtMs: epochMsSchema.exactOptional(),
});

/** Parses an unbonding ready query. */
export const unbondingReadyQuerySchema: z.ZodType<UnbondingReadyQuery> = z.strictObject({
  nowMs: epochMsSchema,
  limit: z.int().min(1).max(1_000),
});

/** Parses what the owner was told is ready. */
export const unbondingToldSchema: z.ZodType<UnbondingTold> = z.strictObject({
  ids: z.array(rowNumberSchema).max(1_000),
  atMs: epochMsSchema,
});

/** Parses a query of one wallet's unbondings in one mode. */
export const unbondingWalletQuerySchema: z.ZodType<UnbondingWalletQuery> = z.strictObject({
  walletId: queryShape.walletId,
  isPaper: queryShape.isPaper,
});

/** Parses an unbonding query. */
export const unbondingQuerySchema: z.ZodType<UnbondingQuery> = z.strictObject(queryShape);

/** Parses an unbonding claim. */
export const unbondingClaimSchema: z.ZodType<UnbondingClaim> = z.strictObject({
  ...queryShape,
  claimIntentId: idSchema("int"),
  requestRefs: z.array(requestRefSchema).min(1).max(1_000),
  atMs: epochMsSchema,
});
