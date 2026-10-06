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

/** Fills when the price crosses `price` in `direction`. */
export interface LimitOrderRequest extends FillBounds {
  readonly kind: "limit";
  readonly trigger: { readonly price: bigint; readonly direction: "above" | "below" };
}

/** Fills when the price rises to `price`. */
export interface TakeProfitOrderRequest extends FillBounds {
  readonly kind: "takeProfit";
  readonly trigger: { readonly price: bigint };
}

/** Fills when the price falls to `price`. */
export interface StopLossOrderRequest extends FillBounds {
  readonly kind: "stopLoss";
  readonly trigger: { readonly price: bigint };
}

/** Fills when the price moves `distanceBps` back from its best since the order started. */
export interface TrailingOrderRequest extends FillBounds {
  readonly kind: "trailing";
  readonly trigger: { readonly distanceBps: Bps };
}

/** Fills on a cron schedule, `count` times when set. */
export interface DcaOrderRequest extends FillBounds {
  readonly kind: "dca";
  readonly trigger: {
    readonly cron: string;
    /** An IANA zone; absent: the owner's timezone. */
    readonly timezone?: string;
    readonly count?: number;
  };
}

/** Copies a leader wallet's buys; sells mirror the share the leader sold. */
export interface CopyOrderRequest extends FillBounds {
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

/** What `webhookRule/create` asks for: a named rule whose alerts fill inside its bounds. */
export interface WebhookRuleRequest extends FillBounds {
  /** The alert's name, which the sender's webhook carries. */
  readonly name: string;
}

const fillBounds = {
  agent: protocolIdSchema("agent"),
  wallet: protocolIdSchema("wallet").exactOptional(),
  token: assetRefSchema,
  side: z.enum(["buy", "sell"]),
  size: fillSizeSchema,
  worstPrice: decimalStringSchema.exactOptional(),
  maxSlippageBps: bpsSchema.exactOptional(),
  expiresAt: epochMsSchema.exactOptional(),
  maxFills: z.int().min(1).exactOptional(),
};

const price = decimalStringSchema;

const limitShape = {
  ...fillBounds,
  kind: z.literal("limit"),
  trigger: z.strictObject({ price, direction: z.enum(["above", "below"]) }),
};
const takeProfitShape = {
  ...fillBounds,
  kind: z.literal("takeProfit"),
  trigger: z.strictObject({ price }),
};
const stopLossShape = {
  ...fillBounds,
  kind: z.literal("stopLoss"),
  trigger: z.strictObject({ price }),
};
const trailingShape = {
  ...fillBounds,
  kind: z.literal("trailing"),
  trigger: z.strictObject({ distanceBps: bpsSchema }),
};
const dcaShape = {
  ...fillBounds,
  kind: z.literal("dca"),
  trigger: z.strictObject({
    cron: z.string().min(1).max(100),
    timezone: z.string().min(1).max(64).exactOptional(),
    count: z.int().min(1).exactOptional(),
  }),
};
const copyShape = {
  ...fillBounds,
  kind: z.literal("copy"),
  trigger: z.strictObject({
    leader: accountRefSchema,
    perBuyUsdMicros: decimalStringSchema,
    dailyUsdMicros: decimalStringSchema,
  }),
};
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
