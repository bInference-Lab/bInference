import { mulDiv } from "@binference/core";
import type { UsdPrice } from "../ports.js";
import type { ExecutionDraft } from "./execution-record.js";

/**
 * A trade as the reconcile step or a paper fill reports it, with the USD prices at the time: the
 * sold token's (the fee is in the same token) and the native coin's (for the gas).
 */
export interface ExecutedTrade extends Omit<
  ExecutionDraft,
  "valueUsdMicros" | "feeUsdMicros" | "gasUsdMicros"
> {
  readonly soldPrice: UsdPrice;
  readonly gasPrice: UsdPrice;
}

/**
 * Values a trade in micro-dollars at the prices of its time. Each value rounds up to the next
 * micro-dollar, as the policy step's do, so the cost of what the trade bought is never
 * understated.
 */
export function valueExecution(trade: ExecutedTrade): ExecutionDraft {
  const { soldPrice, gasPrice, ...draft } = trade;
  return {
    ...draft,
    valueUsdMicros: mulDiv(trade.sold.base, soldPrice, "up"),
    feeUsdMicros: mulDiv(trade.feeBase, soldPrice, "up"),
    gasUsdMicros: mulDiv(trade.gas.base, gasPrice, "up"),
  };
}
