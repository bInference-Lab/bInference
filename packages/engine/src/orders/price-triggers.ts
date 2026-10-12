import { bpsPerWhole, decimalStringSchema, type JsonValue, type Ratio } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { compareRatios, meetsLevel, type PriceLevel } from "./price-level.js";

/**
 * What a trailing stop keeps between prices (decision 0196): its highest price since it became
 * active, in micro-dollars per whole token, exact.
 */
export interface TrailingState {
  readonly peak: Ratio;
}

const ratioSchema = z.strictObject({
  numerator: decimalStringSchema,
  denominator: decimalStringSchema.refine((denominator) => denominator > 0n),
});

const trailingStateSchema = z.strictObject({ peak: ratioSchema });

/** A trailing stop's state as an order's `trigger_state` keeps it: the peak as decimal strings. */
export const trailingStateDocument: DocumentCodec<TrailingState> = documentCodec(
  "trailing stop state",
  trailingStateSchema,
);

/** How a price trigger judged one price: its level, whether the price meets it, a new peak. */
export interface TriggerJudgment {
  /** The level the price is judged against now, which a thin pool's fill must confirm. */
  readonly level: PriceLevel;
  readonly fires: boolean;
  /** A trailing stop's new highest price, when this price is above the one it kept. */
  readonly peak?: Ratio;
}

const at = (price: bigint): Ratio => ({ numerator: price, denominator: 1n });

// The peak a trailing stop keeps, or none when it has none yet or its stored state does not read,
// so it starts again from the price now.
function peakOf(state: JsonValue | undefined): Ratio | undefined {
  const parsed = trailingStateSchema.safeParse(state);
  return parsed.success ? parsed.data.peak : undefined;
}

function trailing(distanceBps: number, kept: JsonValue | undefined, price: Ratio): TriggerJudgment {
  const before = peakOf(kept);
  const isNewPeak = before === undefined || compareRatios(price, before) > 0;
  const peak = isNewPeak ? price : before;
  const stop = {
    numerator: peak.numerator * BigInt(bpsPerWhole - distanceBps),
    denominator: peak.denominator * BigInt(bpsPerWhole),
  };
  const level: PriceLevel = { side: "atOrBelow", price: stop };
  const judged = { level, fires: meetsLevel(price, level) };
  return isNewPeak ? { ...judged, peak } : judged;
}

// The fixed level of a limit, take-profit or stop-loss order.
function levelOf(request: OrderRequest): PriceLevel | undefined {
  if (request.kind === "limit") {
    const side = request.trigger.direction === "above" ? "atOrAbove" : "atOrBelow";
    return { side, price: at(request.trigger.price) };
  }
  if (request.kind === "takeProfit" || request.kind === "stopLoss") {
    const side = request.kind === "takeProfit" ? "atOrAbove" : "atOrBelow";
    return { side, price: at(request.trigger.price) };
  }
  return undefined;
}

/**
 * Judges an order's price trigger on one price, in micro-dollars per whole token (decision 0196):
 * a level, not a crossing between two reads, so a price the watcher skipped past is judged on the
 * next. A limit order fires at or above its price, or at or below it, as its direction says; a
 * take-profit at or above its price; a stop-loss at or below it; a trailing stop at or below its
 * distance under the highest price it kept, this one included. `undefined` for an order its price
 * does not trigger: a DCA or a copy order.
 */
export function judgeTrigger(
  order: { readonly request: OrderRequest; readonly triggerState?: JsonValue },
  price: Ratio,
): TriggerJudgment | undefined {
  const { request } = order;
  if (request.kind === "trailing") {
    return trailing(request.trigger.distanceBps, order.triggerState, price);
  }
  const level = levelOf(request);
  return level === undefined ? undefined : { level, fires: meetsLevel(price, level) };
}
