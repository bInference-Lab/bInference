import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  amountSchema,
  type ChainRef,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type IntentRequest, readIntentRequestSchema } from "../requests/intent-request.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type AssetInfos, assetInfosSchema } from "./asset-info.schema.js";
import { type CardLineView, cardLineViewSchema } from "./card-lines.schema.js";
import { type CardView, cardViewSchema } from "./card-view.schema.js";
import { type IntentKind, intentKindSchema } from "./intent-kind.schema.js";
import { type IntentState, intentStateSchema } from "./intent-state.schema.js";
import { type QuoteView, quoteViewSchema } from "./quote-view.schema.js";
import { type RiskView, riskViewSchema } from "./risk-view.schema.js";

/** The request of a rescue intent, which only `safety/rescue` creates. */
export interface RescueRequest {
  readonly kind: "rescue";
}

/**
 * The request of an unfreeze intent, which only `safety/unfreeze` creates: the agent it unfreezes,
 * or every frozen agent and the install when absent.
 */
export interface UnfreezeRequest {
  readonly kind: "unfreeze";
  readonly agent?: ProtocolId<"agent">;
}

/** The request of an `autoOrder` intent, which only `order/create` creates: the order it confirms. */
export interface AutoOrderRequest {
  readonly kind: "autoOrder";
  readonly order: ProtocolId<"autoOrder">;
}

/** The balance changes a simulation saw for the wallet. */
export interface SimulationView {
  readonly spent: readonly Amount[];
  readonly received: readonly Amount[];
  readonly simulatedAt: number;
  /**
   * Set on a paper sale of a token whose balance no simulation can set, such as a reflection or
   * rebasing token: nothing ran, and the amounts are the quote's. A live trade never has one.
   */
  readonly estimated?: boolean;
}

/** One fill of an intent: what went in, what came out, and its costs in micro-dollars. */
export interface ExecutionView {
  readonly amountIn: Amount;
  readonly amountOut: Amount;
  readonly priceUsdMicros?: bigint;
  readonly feeUsdMicros?: bigint;
  readonly gasUsdMicros?: bigint;
  readonly at: number;
}

/** How an intent ended, or how far it got. */
export interface IntentOutcome {
  /** The reason code stored with a terminal state, such as `daily_cap` or `honeypot`. */
  readonly reason?: string;
  /** The name of the chain a bridge's reason names, the chain it bridges to, as its words show it. */
  readonly chain?: string;
  readonly txHashes?: readonly TxHash[];
  readonly executions?: readonly ExecutionView[];
}

/**
 * Where a bridge's delivery stands (decision 0297): in transit from its deposit's final block,
 * late 2 hours after, delivered once a read of the destination chain found the payment, refunded
 * once a read of the source chain found the bridge paying the wallet back. `minOut` is in the
 * token the route delivers, and `received` what the read found arriving.
 */
interface DeliveryView {
  readonly state: "in_transit" | "late" | "delivered" | "refunded";
  readonly toChain: ChainRef;
  readonly recipient: AccountRef;
  readonly minOut: Amount;
  readonly received?: Amount;
  readonly fillTx?: TxHash;
  readonly refundTx?: TxHash;
  readonly statusUrl?: string;
  readonly sentAt: number;
  readonly lateAt?: number;
  readonly settledAt?: number;
}

/** An intent as every surface draws it, with the info of each asset it mentions. */
export interface IntentView {
  readonly intent: ProtocolId<"intent">;
  readonly agent: ProtocolId<"agent">;
  readonly wallet: ProtocolId<"wallet">;
  readonly kind: IntentKind;
  readonly state: IntentState;
  readonly request: IntentRequest | RescueRequest | UnfreezeRequest | AutoOrderRequest;
  readonly quote?: QuoteView;
  readonly risk?: RiskView;
  readonly simulation?: SimulationView;
  readonly card?: CardView;
  readonly outcome?: IntentOutcome;
  readonly paper: boolean;
  readonly outsideContent: boolean;
  readonly createdAt: number;
  readonly changedAt: number;
  readonly assets: AssetInfos;
  /**
   * A send by name's `.bnb` name in its normalized form, the address it pointed to when the send
   * was proposed, which the card shows and the send pays, and when it was read; absent for any
   * other intent.
   */
  readonly resolvedName?: {
    readonly name: string;
    readonly address: AccountRef;
    readonly resolvedAt: number;
  };
  /** A bridge's delivery, once its deposit is final; absent for any other intent. */
  readonly delivery?: DeliveryView;
  /**
   * The line a live bridge's card ends with as it stands once its deposit is final (spec 4,
   * section 3.9): on its way, then delivered or paid back. Its assets are in `assets`; absent for
   * any other intent.
   */
  readonly bridgeReceipt?: CardLineView;
}

const usdMicros = decimalStringSchema.exactOptional();

const executionViewSchema = z.object({
  amountIn: amountSchema,
  amountOut: amountSchema,
  priceUsdMicros: usdMicros,
  feeUsdMicros: usdMicros,
  gasUsdMicros: usdMicros,
  at: epochMsSchema,
});

/** Parses an intent view. */
export const intentViewSchema: z.ZodType<IntentView> = z.object({
  intent: protocolIdSchema("intent"),
  agent: protocolIdSchema("agent"),
  wallet: protocolIdSchema("wallet"),
  kind: intentKindSchema,
  state: intentStateSchema,
  request: z.union([
    readIntentRequestSchema,
    z.object({ kind: z.literal("rescue") }),
    z.object({ kind: z.literal("unfreeze"), agent: protocolIdSchema("agent").exactOptional() }),
    z.object({ kind: z.literal("autoOrder"), order: protocolIdSchema("autoOrder") }),
  ]),
  quote: quoteViewSchema.exactOptional(),
  risk: riskViewSchema.exactOptional(),
  simulation: z
    .object({
      spent: z.array(amountSchema),
      received: z.array(amountSchema),
      simulatedAt: epochMsSchema,
      estimated: z.boolean().exactOptional(),
    })
    .exactOptional(),
  card: cardViewSchema.exactOptional(),
  outcome: z
    .object({
      reason: z
        .string()
        .regex(/^[a-z][a-z_]*$/)
        .exactOptional(),
      chain: z.string().min(1).max(100).exactOptional(),
      txHashes: z.array(z.string().refine(isTxHash)).exactOptional(),
      executions: z.array(executionViewSchema).exactOptional(),
    })
    .exactOptional(),
  paper: z.boolean(),
  outsideContent: z.boolean(),
  createdAt: epochMsSchema,
  changedAt: epochMsSchema,
  assets: assetInfosSchema,
  resolvedName: z
    .object({ name: z.string().min(1), address: accountRefSchema, resolvedAt: epochMsSchema })
    .exactOptional(),
  delivery: z
    .object({
      state: z.enum(["in_transit", "late", "delivered", "refunded"]),
      toChain: chainRefSchema,
      recipient: accountRefSchema,
      minOut: amountSchema,
      received: amountSchema.exactOptional(),
      fillTx: z.string().refine(isTxHash).exactOptional(),
      refundTx: z.string().refine(isTxHash).exactOptional(),
      statusUrl: z.string().exactOptional(),
      sentAt: epochMsSchema,
      lateAt: epochMsSchema.exactOptional(),
      settledAt: epochMsSchema.exactOptional(),
    })
    .exactOptional(),
  bridgeReceipt: cardLineViewSchema.exactOptional(),
});
