import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type AgentMode, agentModeSchema } from "./agent-view.schema.js";
import { type AssetInfos, assetInfosSchema } from "./asset-info.schema.js";
import { type OrderView, orderViewSchema } from "./order-view.schema.js";
import { type BalanceView, balanceViewSchema } from "./portfolio-view.schema.js";

/**
 * What an agent stands on now (runtime spec, section 7.1): the facts its model reads after the
 * history of each call, never stored with it. Amounts are base units and money is micro-dollars.
 */
export interface LiveFactsView {
  readonly agent: ProtocolId<"agent">;
  /** When the engine read them. */
  readonly at: number;
  /** The owner's timezone, an IANA name, which times are shown in. */
  readonly timeZone: string;
  readonly mode: AgentMode;
  readonly frozen: boolean;
  readonly approvalMode: "manual" | "auto";
  /** The send level in effect, 0 to 3. */
  readonly sendLevel: number;
  /**
   * The agent's wallets' balances in its mode, each with its dollar value when priced; absent when
   * a balance could not be read now.
   */
  readonly balances?: readonly BalanceView[];
  /** The sum of the balances with a known price; absent with the balances. */
  readonly totalUsdMicros?: bigint;
  /** The agent's active and paused auto orders, oldest first, at most 50. */
  readonly orders: readonly OrderView[];
  /** What the agent's outflows of the last 24 hours add up to, in its mode. */
  readonly spentTodayUsdMicros: bigint;
  /** The per-trade cap in effect. */
  readonly perTradeUsdMicros: bigint;
  /** The rolling 24-hour cap in effect, which `spentTodayUsdMicros` counts against. */
  readonly rollingDayUsdMicros: bigint;
  readonly assets: AssetInfos;
}

/** Parses the live facts of `facts/get`. */
export const liveFactsViewSchema: z.ZodType<LiveFactsView> = z.object({
  agent: protocolIdSchema("agent"),
  at: epochMsSchema,
  timeZone: z.string().min(1),
  mode: agentModeSchema,
  frozen: z.boolean(),
  approvalMode: z.enum(["manual", "auto"]),
  sendLevel: z.int().min(0).max(3),
  balances: z.array(balanceViewSchema).exactOptional(),
  totalUsdMicros: decimalStringSchema.exactOptional(),
  orders: z.array(orderViewSchema),
  spentTodayUsdMicros: decimalStringSchema,
  perTradeUsdMicros: decimalStringSchema,
  rollingDayUsdMicros: decimalStringSchema,
  assets: assetInfosSchema,
});
