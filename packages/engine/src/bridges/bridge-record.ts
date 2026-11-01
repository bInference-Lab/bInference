import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  amountSchema,
  type AssetRef,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { decimalStringSchema, type Id, idSchema } from "@binference/core";
import { z } from "zod";
import {
  epochMsSchema,
  pageLimitSchema,
  rowVersionSchema,
  shortTextSchema,
} from "../records/record-fields.js";

/**
 * Where a bridge's delivery stands (database spec, `bridges`): in transit from its deposit's final
 * block, late 2 hours after it, delivered once a read of the destination chain found the payment,
 * refunded once a read of the source chain found the bridge paying the wallet back.
 */
export type BridgeDeliveryState = "in_transit" | "late" | "delivered" | "refunded";

/** The states of a bridge whose delivery is still read. */
export const openBridgeStates: readonly BridgeDeliveryState[] = ["in_transit", "late"];

/** A bridge as its deposit opens it, once the deposit is final (decision 0297). */
export interface BridgeDraft {
  readonly intentId: Id<"int">;
  readonly venue: string;
  /** The deposit's transaction on the source chain, the chain of `sent`. */
  readonly depositTx: TxHash;
  readonly toChain: ChainRef;
  /** Who the destination chain pays, an account of `toChain`. */
  readonly recipient: AccountRef;
  /** What left the wallet: the source chain's token and its exact base units. */
  readonly sent: Amount;
  /** The token the route pays, on `toChain`, with the least the fill pays in it. */
  readonly minOut: Amount;
  /** The destination's coin a fill pays an account with no code in place of the token, if any. */
  readonly deliveredAsCoin?: AssetRef;
  /** What the sent units left their position with, when a position held them. */
  readonly valueUsdMicros?: bigint;
  /** The venue's page for the deposit. */
  readonly statusUrl?: string;
  /** When the deposit's block became final, which starts the 2 hours. */
  readonly sentAtMs: number;
}

/** A bridge as the store keeps it. */
export interface BridgeRecord extends BridgeDraft {
  readonly state: BridgeDeliveryState;
  readonly lateAtMs?: number;
  /** The transaction on `toChain` a read found paying the recipient. */
  readonly fillTx?: TxHash;
  /** The transaction on the source chain a read found paying the wallet back. */
  readonly refundTx?: TxHash;
  /** What the read found arriving: at the recipient, or back at the wallet. */
  readonly received?: Amount;
  readonly settledAtMs?: number;
  /** When a move last wrote the row. */
  readonly checkedAtMs?: number;
  readonly version: number;
}

/**
 * One move of a bridge under the version its mover read: marked late, or settled by a read that
 * found the delivery or the refund.
 */
export type BridgeMove = {
  readonly intentId: Id<"int">;
  readonly expectedVersion: number;
  readonly atMs: number;
} & (
  | { readonly to: "late" }
  | { readonly to: "delivered"; readonly fillTx: TxHash; readonly received: Amount }
  | { readonly to: "refunded"; readonly refundTx: TxHash; readonly received: Amount }
);

/** Why a bridge's move changed nothing: another version or state, or a settlement held already. */
export type BridgeMoveRefusal = "stale" | "taken";

/** Where a page of bridges ends: its last bridge's deposit time and intent. */
export interface BridgeCursor {
  readonly sentAtMs: number;
  readonly intentId: Id<"int">;
}

/**
 * Which bridges to list: those in any of `states`, the oldest deposit first, from the first one
 * after `after` when it is given, so a reader pages through every one.
 */
export interface BridgeQuery {
  readonly states: readonly BridgeDeliveryState[];
  readonly limit: number;
  readonly after?: BridgeCursor;
}

const stateSchema = z.enum(["in_transit", "late", "delivered", "refunded"]);
const txHashSchema = z.string().refine(isTxHash);

const draftShape = {
  intentId: idSchema("int"),
  venue: shortTextSchema,
  depositTx: txHashSchema,
  toChain: chainRefSchema,
  recipient: accountRefSchema,
  sent: amountSchema,
  minOut: amountSchema,
  deliveredAsCoin: assetRefSchema.exactOptional(),
  valueUsdMicros: decimalStringSchema.exactOptional(),
  statusUrl: z.url().max(2_000).exactOptional(),
  sentAtMs: epochMsSchema,
};

/** Parses a bridge as its deposit opens it. */
export const bridgeDraftSchema: z.ZodType<BridgeDraft> = z.strictObject(draftShape);

/** Parses a stored bridge. */
export const bridgeRecordSchema: z.ZodType<BridgeRecord> = z.strictObject({
  ...draftShape,
  state: stateSchema,
  lateAtMs: epochMsSchema.exactOptional(),
  fillTx: txHashSchema.exactOptional(),
  refundTx: txHashSchema.exactOptional(),
  received: amountSchema.exactOptional(),
  settledAtMs: epochMsSchema.exactOptional(),
  checkedAtMs: epochMsSchema.exactOptional(),
  version: rowVersionSchema,
});

const moveBase = {
  intentId: idSchema("int"),
  expectedVersion: rowVersionSchema,
  atMs: epochMsSchema,
};

/** Parses a bridge's move. */
export const bridgeMoveSchema: z.ZodType<BridgeMove> = z.discriminatedUnion("to", [
  z.strictObject({ ...moveBase, to: z.literal("late") }),
  z.strictObject({
    ...moveBase,
    to: z.literal("delivered"),
    fillTx: txHashSchema,
    received: amountSchema,
  }),
  z.strictObject({
    ...moveBase,
    to: z.literal("refunded"),
    refundTx: txHashSchema,
    received: amountSchema,
  }),
]);

/** Parses a bridge query. */
export const bridgeQuerySchema: z.ZodType<BridgeQuery> = z.strictObject({
  states: z.array(stateSchema).min(1),
  limit: pageLimitSchema,
  after: z.strictObject({ sentAtMs: epochMsSchema, intentId: idSchema("int") }).exactOptional(),
});
