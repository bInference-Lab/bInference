import { chainRefSchema } from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { type LimitsRecord, limitsRecordSchema, type LimitsValues } from "@binference/engine";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { LimitsTable } from "../databases/engine-tables.js";
import { decimalText, jsonText, readDecimal, readJson } from "../rows/column-values.js";

// The gas reserve column holds JSON: each chain with its reserve as decimal text.
const gasReserveColumn = z.array(
  z.strictObject({ chain: chainRefSchema, reserveBase: decimalStringSchema }),
);

/** The `limits` columns that hold an agent's limits. */
export type LimitsColumns = Omit<LimitsTable, "agent_id" | "changed_at" | "version">;

/** An agent's limits as their columns store them. */
export function limitsColumns(limits: LimitsValues): LimitsColumns {
  return {
    per_trade_usd_micros: decimalText(limits.perTradeUsdMicros),
    rolling_day_usd_micros: decimalText(limits.rollingDayUsdMicros),
    slippage_registry_bps: limits.slippageRegistryBps,
    slippage_other_bps: limits.slippageOtherBps,
    price_impact_bps: limits.priceImpactBps,
    tax_bps: limits.taxBps,
    liquidity_floor_usd_micros: decimalText(limits.liquidityFloorUsdMicros),
    min_health_factor_bp: limits.minHealthFactorBp,
    gas_reserve: jsonText(z.encode(gasReserveColumn, [...limits.gasReserve])),
    venues: jsonText(limits.venues),
    allow_tokens: jsonText(limits.allowTokens),
    deny_tokens: jsonText(limits.denyTokens),
    model_budget_usd_micros: decimalText(limits.modelBudgetUsdMicros),
    card_trade_expiry_s: limits.cardTradeExpiryS,
    card_other_expiry_s: limits.cardOtherExpiryS,
    requote_after_s: limits.requoteAfterS,
    requote_tolerance_bps: limits.requoteToleranceBps,
    order_expiry_days: limits.orderExpiryDays,
    copy_per_buy_usd_micros: decimalText(limits.copyPerBuyUsdMicros),
    copy_per_leader_day_usd_micros: decimalText(limits.copyPerLeaderDayUsdMicros),
  };
}

/** Reads one `limits` row as its record. */
export function toLimitsRecord(row: Selectable<LimitsTable>): LimitsRecord {
  return limitsRecordSchema.parse({
    agentId: row.agent_id,
    perTradeUsdMicros: readDecimal(row.per_trade_usd_micros),
    rollingDayUsdMicros: readDecimal(row.rolling_day_usd_micros),
    slippageRegistryBps: row.slippage_registry_bps,
    slippageOtherBps: row.slippage_other_bps,
    priceImpactBps: row.price_impact_bps,
    taxBps: row.tax_bps,
    liquidityFloorUsdMicros: readDecimal(row.liquidity_floor_usd_micros),
    minHealthFactorBp: row.min_health_factor_bp,
    gasReserve: gasReserveColumn.parse(readJson(row.gas_reserve)),
    venues: readJson(row.venues),
    allowTokens: readJson(row.allow_tokens),
    denyTokens: readJson(row.deny_tokens),
    modelBudgetUsdMicros: readDecimal(row.model_budget_usd_micros),
    cardTradeExpiryS: row.card_trade_expiry_s,
    cardOtherExpiryS: row.card_other_expiry_s,
    requoteAfterS: row.requote_after_s,
    requoteToleranceBps: row.requote_tolerance_bps,
    orderExpiryDays: row.order_expiry_days,
    copyPerBuyUsdMicros: readDecimal(row.copy_per_buy_usd_micros),
    copyPerLeaderDayUsdMicros: readDecimal(row.copy_per_leader_day_usd_micros),
    changedAtMs: row.changed_at,
    version: row.version,
  });
}
