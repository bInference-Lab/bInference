import { z } from "zod";
import { type Amount, type AmountWire, amountSchema } from "../amount.js";
import { type AccountRef, accountRefParts, accountRefSchema } from "../caip/account-ref.js";
import { type AssetRef, assetRefParts, assetRefSchema } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { ChainEvent } from "../delivery/delivery.js";
import type { TxHash } from "../transaction.js";

/**
 * What the host asks a bridge to quote: move exactly `amountIn` from the wallet's chain to
 * `recipient` on another chain, paid there in `deliveredAsset`. The bridge refuses a recipient or
 * a delivered asset of any other chain.
 */
export interface BridgeQuoteRequest {
  /** The agent's own wallet, which pays and gets any refund. Its chain is the source chain. */
  readonly wallet: AccountRef;
  /** The exact input, in base units of a token of the wallet's chain. */
  readonly amountIn: Amount;
  /** Who the destination chain pays: an account of that chain. */
  readonly recipient: AccountRef;
  /** The token the route pays the recipient, on the recipient's chain. */
  readonly deliveredAsset: AssetRef;
  /**
   * The tokens of the wallet's chain that a 24-hour approval cap of its ceiling names (decision
   * 0305). A route whose token that leaves is not one of them is `no_route`.
   */
  readonly cappedAssets: readonly AssetRef[];
  /** The bridge's declared contracts on the wallet's chain, by their registry names. */
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

/** Who keeps a part of a bridge's input: the bridge's pool, the relayer, or gas on arrival. */
export type BridgeFeeKind = "bridge" | "relayer" | "gas";

/** One part of what a bridge keeps of its input, in base units of the input's token. */
export interface BridgeFee {
  readonly kind: BridgeFeeKind;
  readonly amount: Amount;
}

/** A {@link BridgeFee} as JSON carries it. */
export interface BridgeFeeWire {
  readonly kind: BridgeFeeKind;
  readonly amount: AmountWire;
}

/**
 * Why a bridge quotes no route: it serves none for this request now (`no_route`), the amount is
 * under or over the route's limits (`amount_too_low`, `amount_too_high`), or its relayers hold too
 * little to fill it now (`low_liquidity`). Each is an answer, never a fault, and moves nothing.
 */
export type NoBridgeRoute = "no_route" | "amount_too_low" | "amount_too_high" | "low_liquidity";

/** A bridge's quote for a {@link BridgeQuoteRequest}. */
export interface BridgeQuote {
  /** What the recipient is expected to receive, in base units of the delivered asset. */
  readonly expectedOut: Amount;
  /**
   * The least the deposit lets a fill pay the recipient, in the delivered asset. It is the bridge's
   * word alone: the host floors it by its own price of the input before a card shows it.
   */
  readonly minOut: Amount;
  /**
   * The destination chain's coin, which a fill pays an account with no code in place of the
   * delivered asset, such as ETH for WETH: the delivery is read in both (decision 0301). Left
   * out, the delivered asset alone.
   */
  readonly deliveredAsCoin?: AssetRef;
  /** What the bridge keeps of the input, by kind, each in the input's token. */
  readonly fees: readonly BridgeFee[];
  /** How long the bridge expects the fill to take, in seconds. */
  readonly etaSeconds: number;
  /** When the bridge priced it, epoch milliseconds. */
  readonly quotedAtMs: number;
  /**
   * After this, epoch milliseconds, the quote no longer holds and is asked again. The host checks
   * it against its own clock; the bridge has none.
   */
  readonly expiresAtMs: number;
  /**
   * The bridge's own record of the quote, with what it was asked, given back to its builder; the
   * host never reads it.
   */
  readonly route?: string;
}

/** A {@link BridgeQuote} as JSON carries it. */
export interface BridgeQuoteWire {
  readonly expectedOut: AmountWire;
  readonly minOut: AmountWire;
  readonly deliveredAsCoin?: string;
  readonly fees: readonly BridgeFeeWire[];
  readonly etaSeconds: number;
  readonly quotedAtMs: number;
  readonly expiresAtMs: number;
  readonly route?: string;
}

/**
 * What the host asks a bridge to build after its quote: a deposit of exactly `amountIn` from the
 * wallet to the recipient, whose fill pays at least `minOut`. The host decodes what the bridge
 * built and refuses any other terms.
 */
export interface BridgeBuildRequest extends BridgeQuoteRequest {
  /**
   * The quote the bridge gave for this request. A quote given for another amount, wallet,
   * recipient or asset is refused, never built.
   */
  readonly quote: BridgeQuote;
  /** The least the fill may pay, in base units of the delivered asset. */
  readonly minOut: Amount;
}

/**
 * A deposit that names in its own bytes who the destination chain pays, the least the fill pays
 * and its deadline, such as Across's: the host compares each with the confirmed plan, and a
 * ceiling binds the recipient and chain (decision 0302).
 */
export interface BoundDeposit {
  readonly kind: "bound";
  /** The contract the deposit calls, on the source chain. */
  readonly contract: AccountRef;
  /** The wallet that pays, which any refund goes back to. */
  readonly depositor: AccountRef;
  /** Who the fill pays, an account of the destination chain. */
  readonly recipient: AccountRef;
  /** What leaves: the token of the source chain and its exact base units. */
  readonly amountIn: Amount;
  /** The delivered asset and the least the fill pays in it. */
  readonly minOut: Amount;
  /** Epoch milliseconds after which no fill may pay it, and it is refunded. */
  readonly fillDeadlineMs: number;
}

/**
 * A deposit that names only its depositor, the token and amount that leave, and an order id, such
 * as Relay's: who is paid, where and how much live in the bridge's off-chain order, which no
 * ceiling reads. Only a bridge wallet may make one (decisions 0303 and 0307).
 */
export interface OrderDeposit {
  readonly kind: "order";
  /** The contract the deposit calls, on the source chain. */
  readonly contract: AccountRef;
  readonly depositor: AccountRef;
  readonly amountIn: Amount;
  /** The bridge's id of the off-chain order the deposit pays, as its bytes write it. */
  readonly orderId: string;
}

/** What a bridge's deposit call does, read back from its bytes alone (decision 0317). */
export type DecodedDeposit = BoundDeposit | OrderDeposit;

/** A {@link DecodedDeposit} as JSON carries it. */
export type DecodedDepositWire =
  | {
      readonly kind: "bound";
      readonly contract: string;
      readonly depositor: string;
      readonly recipient: string;
      readonly amountIn: AmountWire;
      readonly minOut: AmountWire;
      readonly fillDeadlineMs: number;
    }
  | {
      readonly kind: "order";
      readonly contract: string;
      readonly depositor: string;
      readonly amountIn: AmountWire;
      readonly orderId: string;
    };

/** A chain a bridge delivers to, with the id its deposit names that chain by. */
export interface BridgeDestination {
  readonly chain: ChainRef;
  /** The id in decimal, which a chain outside EIP-155 gets from each bridge on its own. */
  readonly id: string;
}

/** A deposit sent on a chain, by its transaction. */
export interface DepositRef {
  readonly chain: ChainRef;
  readonly hash: TxHash;
}

/**
 * Where a deposit stands by the bridge's own word: not seen yet, waiting for a fill, filled by a
 * transaction on the destination chain, past its fill deadline, or paid back to the depositor by
 * a transaction on the source chain. Only a read of the chain says funds moved (decision 0297).
 */
export type DepositState =
  | { readonly kind: "unseen" }
  | { readonly kind: "pending" }
  | { readonly kind: "filled"; readonly fill: DepositRef }
  | { readonly kind: "expired" }
  | { readonly kind: "refunded"; readonly refund: DepositRef };

/** One side of a settlement check: a transaction on its chain, and the events it emitted. */
export interface SettlementSide {
  readonly ref: DepositRef;
  readonly events: readonly ChainEvent[];
}

/**
 * What a host asks a bridge to match (decision 0320): a deposit, and a transaction the bridge's
 * status named as that deposit's fill on the destination chain or its refund on the source chain,
 * each with the events a read of its chain found; and what the deposit must have sent and paid.
 */
export interface SettlementCheck {
  readonly kind: "fill" | "refund";
  readonly deposit: SettlementSide;
  readonly settlement: SettlementSide;
  /** The wallet that deposited, which a refund pays back. */
  readonly wallet: AccountRef;
  readonly amountIn: Amount;
  readonly recipient: AccountRef;
  /** The least output, in the token the route delivers. */
  readonly minOut: Amount;
}

/** What a bridge says of one deposit, with its own page for it. */
export interface DepositStatus {
  readonly state: DepositState;
  /** The bridge's page for the deposit, for the owner. */
  readonly statusUrl: string;
}

const feeSchema: z.ZodType<BridgeFee, BridgeFeeWire> = z.strictObject({
  kind: z.enum(["bridge", "relayer", "gas"]),
  amount: amountSchema,
});

const epochMsSchema = z.int().nonnegative();

// Both amounts name the delivered asset, the expected one never below the least, and a coin the
// fill may pay instead is of the delivered asset's chain.
function isOrdered(
  quote: Pick<BridgeQuote, "expectedOut" | "minOut" | "deliveredAsCoin">,
): boolean {
  const { expectedOut, minOut, deliveredAsCoin } = quote;
  const chain = assetRefParts(expectedOut.asset).chain;
  return (
    expectedOut.asset === minOut.asset &&
    minOut.base <= expectedOut.base &&
    (deliveredAsCoin === undefined || assetRefParts(deliveredAsCoin).chain === chain)
  );
}

function expiresLater(quote: Pick<BridgeQuote, "quotedAtMs" | "expiresAtMs">): boolean {
  return quote.quotedAtMs < quote.expiresAtMs;
}

/**
 * Decodes a bridge quote from JSON, and encodes it back with `z.encode`. A least amount above the
 * expected one, or in another asset, a coin of another chain, and an expiry before the quote are
 * refused.
 */
export const bridgeQuoteSchema: z.ZodType<BridgeQuote, BridgeQuoteWire> = z
  .strictObject({
    expectedOut: amountSchema,
    minOut: amountSchema,
    deliveredAsCoin: assetRefSchema.exactOptional(),
    fees: z.array(feeSchema),
    etaSeconds: z.int().nonnegative(),
    quotedAtMs: epochMsSchema,
    expiresAtMs: epochMsSchema,
    route: z.string().exactOptional(),
  })
  .refine(isOrdered, { message: "The least amount is the delivered asset's, at most expected." })
  .refine(expiresLater, { message: "A quote expires after it is given." });

// The recipient and the delivered asset are of one chain.
function isOneDestination(deposit: Pick<BoundDeposit, "recipient" | "minOut">): boolean {
  return accountRefParts(deposit.recipient).chain === assetRefParts(deposit.minOut.asset).chain;
}

const boundSchema = z
  .strictObject({
    kind: z.literal("bound"),
    contract: accountRefSchema,
    depositor: accountRefSchema,
    recipient: accountRefSchema,
    amountIn: amountSchema,
    minOut: amountSchema,
    fillDeadlineMs: epochMsSchema,
  })
  .refine(isOneDestination, { message: "The recipient and the delivered asset share a chain." });

const orderSchema = z.strictObject({
  kind: z.literal("order"),
  contract: accountRefSchema,
  depositor: accountRefSchema,
  amountIn: amountSchema,
  orderId: z.string().min(1).max(128),
});

/**
 * Decodes a decoded deposit from JSON, and encodes it back with `z.encode`: a bound deposit, whose
 * recipient must be of its delivered asset's chain, or an order deposit with its order id.
 */
export const decodedDepositSchema: z.ZodType<DecodedDeposit, DecodedDepositWire> = z.union([
  boundSchema,
  orderSchema,
]);
