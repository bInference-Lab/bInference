import {
  type AccountRef,
  type AssetRef,
  accountRefSchema,
  assetRefSchema,
} from "@binference/chain";
import { type Bps, bpsSchema, decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type FillSize, fillSizeSchema } from "../values/token-amount.schema.js";

/**
 * The bounds every fill of an auto order or a webhook rule stays inside. The owner confirms them
 * once, on one card; each fill then runs policy and risk again, without a card.
 */
export interface FillBounds {
  readonly agent: ProtocolId<"agent">;
  /** The wallet that acts; absent: the agent's first wallet. */
  readonly wallet?: ProtocolId<"wallet">;
  readonly token: AssetRef;
  readonly side: "buy" | "sell";
  readonly size: FillSize;
  /** The worst price a fill accepts, in micro-dollars per whole token. */
  readonly worstPrice?: bigint;
  readonly maxSlippageBps?: Bps;
  /** Absent: the agent's default expiry, 30 days. */
  readonly expiresAt?: number;
  /** Absent: one fill for a limit, take-profit or stop-loss order. */
  readonly maxFills?: number;
}

/** What every auto order request carries besides its bounds. */
export interface OrderBase extends FillBounds {
  /**
   * What a buy order spends: the chain's coin or a token the registry lists, such as a stablecoin.
   * Absent: the chain's coin. `size` counts it: `{ base }` in its base units, `{ percentBps }` as a
   * share of what the wallet can spend of it when a fill is quoted. A sell order names none.
   */
  readonly spend?: AssetRef;
  /**
   * The agent's words on why, shown on the order's card as what the agent says, escaped and cut
   * to 200 characters. A client other than the agent may leave it out.
   */
  readonly reason?: string;
}

/** Fills when the price is at or above `price`, or at or below it, as `direction` says. */
export interface LimitOrderRequest extends OrderBase {
  readonly kind: "limit";
  readonly trigger: { readonly price: bigint; readonly direction: "above" | "below" };
}

/** Fills when the price rises to `price`. */
export interface TakeProfitOrderRequest extends OrderBase {
  readonly kind: "takeProfit";
  readonly trigger: { readonly price: bigint };
}

/** Fills when the price falls to `price`. */
export interface StopLossOrderRequest extends OrderBase {
  readonly kind: "stopLoss";
  readonly trigger: { readonly price: bigint };
}

/** Fills when the price moves `distanceBps` back from its best since the order started. */
export interface TrailingOrderRequest extends OrderBase {
  readonly kind: "trailing";
  readonly trigger: { readonly distanceBps: Bps };
}

/** Fills on a cron schedule, `count` times when set. */
export interface DcaOrderRequest extends OrderBase {
  readonly kind: "dca";
  readonly trigger: {
    readonly cron: string;
    /** An IANA zone; absent: the owner's timezone. */
    readonly timezone?: string;
    readonly count?: number;
  };
}

/** Copies a leader wallet's buys; sells mirror the share the leader sold. */
export interface CopyOrderRequest extends OrderBase {
  readonly kind: "copy";
  readonly trigger: {
    readonly leader: AccountRef;
    readonly perBuyUsdMicros: bigint;
    readonly dailyUsdMicros: bigint;
  };
}

/** What `order/create` asks for: an auto order of one `kind`, with its trigger. */
export type OrderRequest =
  | LimitOrderRequest
  | TakeProfitOrderRequest
  | StopLossOrderRequest
  | TrailingOrderRequest
  | DcaOrderRequest
  | CopyOrderRequest;

/** One kind of order's terms, without the agent and wallet that act. */
type TermsOf<Request> = Request extends unknown ? Omit<Request, "agent" | "wallet"> : never;

/**
 * An auto order's terms: what the agent names, without who acts, which its runtime fills. The
 * agent always gives its reason.
 */
export type OrderTerms = TermsOf<OrderRequest & { readonly reason: string }>;

/** What `webhookRule/create` asks for: a named rule whose alerts fill inside its bounds. */
export interface WebhookRuleRequest extends FillBounds {
  /** The alert's name, which the sender's webhook carries. */
  readonly name: string;
}

const boundsFields = {
  token: assetRefSchema,
  side: z.enum(["buy", "sell"]),
  size: fillSizeSchema,
  worstPrice: decimalStringSchema.exactOptional(),
  maxSlippageBps: bpsSchema.exactOptional(),
  expiresAt: epochMsSchema.exactOptional(),
  maxFills: z.int().min(1).exactOptional(),
};
const fillBounds = {
  agent: protocolIdSchema("agent"),
  wallet: protocolIdSchema("wallet").exactOptional(),
  ...boundsFields,
};
const reason = z.string().min(1);
const spend = assetRefSchema.exactOptional();
const orderBase = { ...fillBounds, spend, reason: reason.exactOptional() };
const termsBase = { ...boundsFields, spend, reason };

const price = decimalStringSchema;

const limitFields = {
  kind: z.literal("limit"),
  trigger: z.strictObject({ price, direction: z.enum(["above", "below"]) }),
};
const takeProfitFields = { kind: z.literal("takeProfit"), trigger: z.strictObject({ price }) };
const stopLossFields = { kind: z.literal("stopLoss"), trigger: z.strictObject({ price }) };
const trailingFields = {
  kind: z.literal("trailing"),
  trigger: z.strictObject({ distanceBps: bpsSchema }),
};
const dcaFields = {
  kind: z.literal("dca"),
  trigger: z.strictObject({
    cron: z.string().min(1).max(100),
    timezone: z.string().min(1).max(64).exactOptional(),
    count: z.int().min(1).exactOptional(),
  }),
};
const copyFields = {
  kind: z.literal("copy"),
  trigger: z.strictObject({
    leader: accountRefSchema,
    perBuyUsdMicros: decimalStringSchema,
    dailyUsdMicros: decimalStringSchema,
  }),
};
const limitShape = { ...orderBase, ...limitFields };
const takeProfitShape = { ...orderBase, ...takeProfitFields };
const stopLossShape = { ...orderBase, ...stopLossFields };
const trailingShape = { ...orderBase, ...trailingFields };
const dcaShape = { ...orderBase, ...dcaFields };
const copyShape = { ...orderBase, ...copyFields };
const webhookRuleShape = { ...fillBounds, name: z.string().min(1).max(64) };

/** Parses the args of `order/create`. Unknown fields are refused. */
export const orderRequestSchema: z.ZodType<OrderRequest> = z.discriminatedUnion("kind", [
  z.strictObject(limitShape),
  z.strictObject(takeProfitShape),
  z.strictObject(stopLossShape),
  z.strictObject(trailingShape),
  z.strictObject(dcaShape),
  z.strictObject(copyShape),
]);

/**
 * Parses an auto order's terms: the request without the agent and wallet that act, which the agent
 * runtime fills for its agent. Unknown fields, a wallet among them, are refused.
 */
export const orderTermsSchema: z.ZodType<OrderTerms> = z.discriminatedUnion("kind", [
  z.strictObject({ ...termsBase, ...limitFields }),
  z.strictObject({ ...termsBase, ...takeProfitFields }),
  z.strictObject({ ...termsBase, ...stopLossFields }),
  z.strictObject({ ...termsBase, ...trailingFields }),
  z.strictObject({ ...termsBase, ...dcaFields }),
  z.strictObject({ ...termsBase, ...copyFields }),
]);

/** Parses an order request as an order view carries it, dropping fields a newer engine adds. */
export const readOrderRequestSchema: z.ZodType<OrderRequest> = z.discriminatedUnion("kind", [
  z.object(limitShape),
  z.object(takeProfitShape),
  z.object(stopLossShape),
  z.object(trailingShape),
  z.object(dcaShape),
  z.object(copyShape),
]);

/** Parses the args of `webhookRule/create`. Unknown fields are refused. */
export const webhookRuleRequestSchema: z.ZodType<WebhookRuleRequest> =
  z.strictObject(webhookRuleShape);

/** Parses a webhook rule request as a rule view carries it, dropping fields a newer engine adds. */
export const readWebhookRuleRequestSchema: z.ZodType<WebhookRuleRequest> =
  z.object(webhookRuleShape);
