import { bpsPerWhole, decimalStringSchema, type JsonValue, type Ratio } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { compareRatios, meetsLevel, type PriceLevel } from "./price-level.js";

/**
 * What a price trigger keeps between prices (decisions 0196 and 0197): a trailing stop's highest
 * price since it last became armed, in micro-dollars per whole token, exact; and, after a fill of
 * an order with fills left, that it waits for its condition to stop holding before it fires again.
 */
export interface TriggerState {
  readonly peak?: Ratio;
  readonly disarmed?: true;
}

const ratioSchema = z.strictObject({
  numerator: decimalStringSchema,
  denominator: decimalStringSchema.refine((denominator) => denominator > 0n),
});

const triggerStateSchema = z.strictObject({
  peak: ratioSchema.exactOptional(),
  disarmed: z.literal(true).exactOptional(),
});

/** A trigger's state as an order's `trigger_state` keeps it: the peak as decimal strings. */
export const triggerStateDocument: DocumentCodec<TriggerState> = documentCodec(
  "trigger state",
  triggerStateSchema,
);

/**
 * The state an order with a fill left takes with its fill (decision 0197): no peak, and disarmed
 * until a price at which its condition does not hold.
 */
export const disarmedAfterFill: JsonValue = triggerStateDocument.encode({ disarmed: true });

/** How a price trigger judged one price: its level, whether it fires, and its new state. */
export interface TriggerJudgment {
  /** The level the price is judged against now, which a fill's own quote may have to meet. */
  readonly level: PriceLevel;
  readonly fires: boolean;
  /** The state to keep, when this price changed it: a new peak, or the order armed again. */
  readonly state?: TriggerState;
}

const at = (price: bigint): Ratio => ({ numerator: price, denominator: 1n });

// The state a trigger keeps, or none when its stored state does not read, so it starts again
// from the price now, armed.
function stateOf(kept: JsonValue | undefined): TriggerState {
  const parsed = triggerStateSchema.safeParse(kept);
  return parsed.success ? parsed.data : {};
}

// A trailing stop's level now and the peak it keeps, this price included.
function trailingLevel(
  distanceBps: number,
  peakBefore: Ratio | undefined,
  price: Ratio,
): { readonly level: PriceLevel; readonly peak: Ratio; readonly isNewPeak: boolean } {
  const isNewPeak = peakBefore === undefined || compareRatios(price, peakBefore) > 0;
  const peak = isNewPeak ? price : peakBefore;
  const stop = {
    numerator: peak.numerator * BigInt(bpsPerWhole - distanceBps),
    denominator: peak.denominator * BigInt(bpsPerWhole),
  };
  return { level: { side: "atOrBelow", price: stop }, peak, isNewPeak };
}

// The fixed level of a limit, take-profit or stop-loss order.
function fixedLevel(request: OrderRequest): PriceLevel | undefined {
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

// The level and the kept peak, before the arming is weighed.
function levelNow(
  request: OrderRequest,
  kept: TriggerState,
  price: Ratio,
): { readonly level: PriceLevel; readonly peak?: Ratio; readonly isNewPeak: boolean } | undefined {
  if (request.kind === "trailing") {
    return trailingLevel(request.trigger.distanceBps, kept.peak, price);
  }
  const level = fixedLevel(request);
  return level === undefined ? undefined : { level, isNewPeak: false };
}

/**
 * Judges an order's price trigger on one price, in micro-dollars per whole token (decisions 0196
 * and 0197): a level, not a crossing, so a price the watcher skipped past is judged on the next. A
 * limit order's condition holds at or above its price, or at or below it, as its direction says; a
 * take-profit's at or above its price; a stop-loss's at or below it; a trailing stop's at or below
 * its distance under the highest price it kept, this one included. An armed order fires while its
 * condition holds; a disarmed one fires nothing, and arms again at a price where it does not.
 * `undefined` for an order its price does not trigger: a DCA or a copy order.
 */
export function judgeTrigger(
  order: { readonly request: OrderRequest; readonly triggerState?: JsonValue },
  price: Ratio,
): TriggerJudgment | undefined {
  const kept = stateOf(order.triggerState);
  const now = levelNow(order.request, kept, price);
  if (now === undefined) {
    return undefined;
  }
  const holds = meetsLevel(price, now.level);
  const isDisarmed = kept.disarmed === true;
  const rearms = isDisarmed && !holds;
  const fires = !isDisarmed && holds;
  if (!now.isNewPeak && !rearms) {
    return { level: now.level, fires };
  }
  const peak = now.peak === undefined ? {} : { peak: now.peak };
  const state: TriggerState = isDisarmed && holds ? { ...peak, disarmed: true } : peak;
  return { level: now.level, fires, state };
}
