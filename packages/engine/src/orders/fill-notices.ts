import { mulDiv, type Ratio } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import type { PaperFill } from "../intents/event-cause.schema.js";
import type { Notice, NoticePart } from "../pushes/notice-push.js";
import type { OrderFillReason } from "./order-fill.js";
import type { OrderRecord } from "./order-record.js";
import { wholeTokenPrice } from "./price-level.js";

// Dollars read the same in every language (`$1.20`), so the notice carries them as text.
const dollars = createFormatter({ locale: "en", timeZone: "UTC" });
const centMicros = 10_000n;

// The price times 10 to the `power`, in micro-dollars, rounded down; a negative power divides.
function scaledMicros(price: Ratio, power: number): bigint {
  return power >= 0
    ? mulDiv(10n ** BigInt(power), price, "down")
    : mulDiv(1n, price, "down") / 10n ** BigInt(-power);
}

// The power that leaves the price two digits long, 10 to 99, in micro-dollars.
function twoDigitPower(price: Ratio, power: number): number {
  const scaled = scaledMicros(price, power);
  if (scaled >= 100n) {
    return twoDigitPower(price, power - 1);
  }
  return scaled < 10n ? twoDigitPower(price, power + 1) : power;
}

/**
 * A price in micro-dollars per whole token as a notice shows it: to the cent from a cent up, and
 * to two significant digits below, rounded down, as `$0.0000075`.
 */
export function priceText(price: Ratio): string {
  const micros = mulDiv(1n, price, "down");
  if (micros >= centMicros || price.numerator === 0n) {
    return dollars.usd(micros);
  }
  const power = twoDigitPower(price, 0);
  const digits = scaledMicros(price, power).toString();
  return `$0.${digits.padStart(6 + power, "0")}`;
}

const orderKindOf = (order: Pick<OrderRecord, "kind">): NoticePart => ({
  key: "order.kind",
  values: { kind: order.kind },
});

/**
 * `notice.fill` for an order's paper fill (spec 4, section 4): what it bought or sold, its value in
 * dollars at the fill and its price per whole token, marked as paper for a paper order.
 */
export function fillNotice(
  order: Pick<OrderRecord, "agentId" | "kind" | "isPaper" | "request">,
  fill: PaperFill & { readonly soldPrice: Ratio },
  tokenDecimals: number,
): Notice {
  const isBuy = order.request.side === "buy";
  const valueMicros = mulDiv(fill.amountIn.base, fill.soldPrice, "down");
  const token = isBuy ? fill.amountOut : fill.amountIn;
  const perBaseUnit = { numerator: valueMicros, denominator: token.base === 0n ? 1n : token.base };
  const price = priceText(wholeTokenPrice(perBaseUnit, tokenDecimals));
  const value = dollars.usd(valueMicros);
  const result: NoticePart = {
    key: isBuy ? "fill.buy" : "fill.sell",
    values: isBuy ? { spent: value, price } : { received: value, price },
    amounts: { amount: token },
  };
  return {
    key: "notice.fill",
    agent: order.agentId,
    values: { mode: order.isPaper ? "paper" : "live" },
    parts: { orderKind: orderKindOf(order), result },
  };
}

/**
 * `notice.skipped` for a fill an order skipped (spec 4, section 4), with its reason's message; a
 * reason that names the 24-hour cap carries what was used of it and the cap, in dollars.
 */
export function skippedNotice(
  order: Pick<OrderRecord, "agentId" | "kind">,
  skip: {
    readonly reason: OrderFillReason;
    readonly cap?: { readonly usedUsdMicros: bigint; readonly capUsdMicros: bigint };
  },
): Notice {
  const { reason, cap } = skip;
  const values =
    cap === undefined
      ? {}
      : { used: dollars.usd(cap.usedUsdMicros), cap: dollars.usd(cap.capUsdMicros) };
  return {
    key: "notice.skipped",
    agent: order.agentId,
    values: {},
    parts: { orderKind: orderKindOf(order), reason: { key: `reason.${reason}`, values } },
  };
}
