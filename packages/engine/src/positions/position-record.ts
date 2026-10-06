import { type AssetRef, assetRefSchema } from "@binference/chain";
import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import { signedUsdMicrosSchema } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema, rowVersionSchema } from "../records/record-fields.js";
import { type ExecutionDraft, executionDraftSchema } from "./execution-record.js";

/** Which position: one wallet's holding of one asset, paper and live kept apart. */
export interface PositionKey {
  readonly walletId: Id<"wal">;
  readonly asset: AssetRef;
  readonly isPaper: boolean;
}

/**
 * A position at average cost: the base units held, what they cost in micro-dollars with fees and
 * gas, and the profit or loss realized so far, below zero for a loss. Nothing held costs nothing.
 */
export interface PositionState extends PositionKey {
  readonly quantityBase: bigint;
  readonly costUsdMicros: bigint;
  readonly realizedUsdMicros: bigint;
  readonly changedAtMs: number;
}

const stateShape = {
  walletId: idSchema("wal"),
  asset: assetRefSchema,
  isPaper: z.boolean(),
  quantityBase: decimalStringSchema,
  costUsdMicros: decimalStringSchema,
  realizedUsdMicros: signedUsdMicrosSchema,
  changedAtMs: epochMsSchema,
};

/** Parses a position's state. */
export const positionStateSchema: z.ZodType<PositionState> = z.strictObject(stateShape);

/** A position as stored, with its row version: 0 when written, one more with each change. */
export interface PositionRecord extends PositionState {
  readonly version: number;
}

/** Parses a stored position. */
export const positionRecordSchema: z.ZodType<PositionRecord> = z.strictObject({
  ...stateShape,
  version: rowVersionSchema,
});

/**
 * A position's new state and the row version it was computed from; no `readVersion` means the
 * position had no row.
 */
export interface PositionWrite {
  readonly position: PositionState;
  readonly readVersion?: number;
}

/** Parses a position write. */
export const positionWriteSchema: z.ZodType<PositionWrite> = z.strictObject({
  position: positionStateSchema,
  readVersion: rowVersionSchema.exactOptional(),
});

/** An execution with the position changes it makes, stored all or nothing. */
export interface ExecutionWrite {
  readonly execution: ExecutionDraft;
  readonly positions: readonly PositionWrite[];
}

/** Parses an execution write. */
export const executionWriteSchema: z.ZodType<ExecutionWrite> = z.strictObject({
  execution: executionDraftSchema,
  positions: z.array(positionWriteSchema),
});

/** Which positions to list: one wallet's, paper or live. */
export interface PositionQuery {
  readonly walletId: Id<"wal">;
  readonly isPaper: boolean;
}

/** Parses a position query. */
export const positionQuerySchema: z.ZodType<PositionQuery> = z.strictObject({
  walletId: idSchema("wal"),
  isPaper: z.boolean(),
});
