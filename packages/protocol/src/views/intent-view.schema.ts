import { type Amount, amountSchema, isTxHash, type TxHash } from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type IntentRequest, readIntentRequestSchema } from "../requests/intent-request.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type AssetInfos, assetInfosSchema } from "./asset-info.schema.js";
import { type CardView, cardViewSchema } from "./card-view.schema.js";
import { type IntentKind, intentKindSchema } from "./intent-kind.schema.js";
import { type IntentState, intentStateSchema } from "./intent-state.schema.js";
import { type QuoteView, quoteViewSchema } from "./quote-view.schema.js";
import { type RiskView, riskViewSchema } from "./risk-view.schema.js";

/** The request of a rescue intent, which only `safety/rescue` creates. */
export interface RescueRequest {
  readonly kind: "rescue";
}

/** The balance changes a simulation saw for the wallet. */
export interface SimulationView {
  readonly spent: readonly Amount[];
  readonly received: readonly Amount[];
  readonly simulatedAt: number;
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
  readonly txHashes?: readonly TxHash[];
  readonly executions?: readonly ExecutionView[];
}

/** An intent as every surface draws it, with the info of each asset it mentions. */
export interface IntentView {
  readonly intent: ProtocolId<"intent">;
  readonly agent: ProtocolId<"agent">;
  readonly wallet: ProtocolId<"wallet">;
  readonly kind: IntentKind;
  readonly state: IntentState;
  readonly request: IntentRequest | RescueRequest;
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
  request: z.union([readIntentRequestSchema, z.object({ kind: z.literal("rescue") })]),
  quote: quoteViewSchema.exactOptional(),
  risk: riskViewSchema.exactOptional(),
  simulation: z
    .object({
      spent: z.array(amountSchema),
      received: z.array(amountSchema),
      simulatedAt: epochMsSchema,
    })
    .exactOptional(),
  card: cardViewSchema.exactOptional(),
  outcome: z
    .object({
      reason: z
        .string()
        .regex(/^[a-z][a-z_]*$/)
        .exactOptional(),
      txHashes: z.array(z.string().refine(isTxHash)).exactOptional(),
      executions: z.array(executionViewSchema).exactOptional(),
    })
    .exactOptional(),
  paper: z.boolean(),
  outsideContent: z.boolean(),
  createdAt: epochMsSchema,
  changedAt: epochMsSchema,
  assets: assetInfosSchema,
});
