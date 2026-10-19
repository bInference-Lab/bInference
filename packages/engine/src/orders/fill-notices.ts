import { mulDiv, type Ratio } from "@binference/core";
import { addressPartOf, createFormatter, displayOutsideText, shortAddress } from "@binference/i18n";
import type { AssetInfos } from "@binference/protocol";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import type { PaperFill } from "../intents/event-cause.schema.js";
import type { Notice, NoticePart } from "../pushes/notice-push.js";
import { copyStateOf, type CopyTaking, isTakenLate } from "./copy-state.js";
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

/** The agent's address book, which names a copy order's leader in its notices. */
type AddressBook = readonly Pick<AddressEntryRecord, "account" | "label">[];

/** A copy order's leader as its notices name it, and the leader's trade it copies now. */
interface CopyNoticeFacts {
  readonly leader: string;
  readonly taking: CopyTaking;
}

// A copy order's leader by its label in the agent's address book, else its short address, and
// the trade it took (spec 4, section 4.3); none for another order or one with no trade taken.
function copyFactsOf(
  order: Pick<OrderRecord, "request" | "triggerState">,
  book: AddressBook,
): CopyNoticeFacts | undefined {
  const { request } = order;
  const taking = request.kind === "copy" ? copyStateOf(order.triggerState)?.taking : undefined;
  if (request.kind !== "copy" || taking === undefined) {
    return undefined;
  }
  const { leader } = request.trigger;
  const label = book.find(({ account }) => account === leader)?.label;
  return { leader: label ?? shortAddress(addressPartOf(leader)), taking };
}

// Spec 4, section 1: a symbol is cut past 16 characters.
const symbolLength = 16;

// A token as a copy notice names it: the registry's symbol; else the symbol its contract answered,
// which its deployer chose, shown as outside text, then its short address; else its short address.
function copyTokenText(taking: CopyTaking): string {
  const { facts } = taking;
  const address = shortAddress(addressPartOf(taking.asset));
  if (facts === undefined) {
    return address;
  }
  const symbol = displayOutsideText(facts.symbol, symbolLength);
  return facts.verified ? facts.symbol : `${symbol} ${address}`;
}

// What names a skipped fill's order: the leader's trade a copy order took, else the order's kind.
function skipOrderPart(
  order: Pick<OrderRecord, "kind" | "request" | "triggerState">,
  book: AddressBook,
): NoticePart {
  const copy = copyFactsOf(order, book);
  if (copy === undefined) {
    return orderKindOf(order);
  }
  const { side } = copy.taking;
  return {
    key: "fill.copyTrade",
    values: { leader: copy.leader, side, token: copyTokenText(copy.taking) },
  };
}

// A copied fill's result: what it bought or sold for the leader's trade, the share sold, and for
// a sale past its minute, when the leader sold (decision 0260).
function copyResultOf(
  copy: CopyNoticeFacts,
  fill: { readonly token: PaperFill["amountIn"]; readonly value: string; readonly atMs: number },
): NoticePart {
  const { leader, taking } = copy;
  const amounts = { amount: fill.token };
  if (taking.side === "buy") {
    return { key: "fill.copyBuy", values: { leader, spent: fill.value }, amounts };
  }
  const share = taking.shareSoldBps === undefined ? "?" : dollars.percent(taking.shareSoldBps);
  const values = { leader, share, received: fill.value };
  return isTakenLate(taking, fill.atMs)
    ? { key: "fill.copySellLate", values, times: { when: taking.atMs }, amounts }
    : { key: "fill.copySell", values, amounts };
}

// A fill's result: what it bought or sold, for how many dollars, at its price per whole token.
function plainResultOf(fill: {
  readonly isBuy: boolean;
  readonly token: PaperFill["amountIn"];
  readonly value: string;
  readonly valueMicros: bigint;
  readonly decimals: number;
}): NoticePart {
  const { isBuy, token, value } = fill;
  const perBaseUnit = {
    numerator: fill.valueMicros,
    denominator: token.base === 0n ? 1n : token.base,
  };
  const price = priceText(wholeTokenPrice(perBaseUnit, fill.decimals));
  return {
    key: isBuy ? "fill.buy" : "fill.sell",
    values: isBuy ? { spent: value, price } : { received: value, price },
    amounts: { amount: token },
  };
}

// The notice's assets with what an unlisted token a copy order traded answered on chain.
function withCopiedToken(assets: AssetInfos, taking: CopyTaking): AssetInfos {
  const { facts } = taking;
  return facts === undefined || facts.verified ? assets : { ...assets, [taking.asset]: facts };
}

/**
 * `notice.fill` for an order's paper fill (spec 4, section 4): what it bought or sold, its value in
 * dollars at the fill and its price per whole token, marked as paper for a paper order; a copy
 * order's names its leader's trade instead of the price (decision 0260). A token the registry does
 * not list is named by `assets`, what the order's card stored of it or what it answered as a copy
 * order took its trade.
 */
export function fillNotice(
  order: Pick<OrderRecord, "agentId" | "kind" | "isPaper" | "request" | "triggerState">,
  fill: PaperFill & { readonly soldPrice: Ratio },
  traded: { readonly decimals: number; readonly assets: AssetInfos; readonly book?: AddressBook },
): Notice {
  const copy = copyFactsOf(order, traded.book ?? []);
  const isBuy = (copy?.taking.side ?? order.request.side) === "buy";
  const valueMicros = mulDiv(fill.amountIn.base, fill.soldPrice, "down");
  const token = isBuy ? fill.amountOut : fill.amountIn;
  const value = dollars.usd(valueMicros);
  const result =
    copy === undefined
      ? plainResultOf({ isBuy, token, value, valueMicros, decimals: traded.decimals })
      : copyResultOf(copy, { token, value, atMs: fill.atMs });
  const assets = copy === undefined ? traded.assets : withCopiedToken(traded.assets, copy.taking);
  return {
    key: "notice.fill",
    agent: order.agentId,
    values: { mode: order.isPaper ? "paper" : "live" },
    parts: { orderKind: orderKindOf(order), result },
    ...(Object.keys(assets).length === 0 ? {} : { assets }),
  };
}

/**
 * `notice.skipped` for a fill an order skipped (spec 4, section 4), with its reason's message; a
 * reason that names a cap carries what was used of it and the cap, in dollars. A copy order's
 * names the leader's trade and its token (decision 0260).
 */
export function skippedNotice(
  order: Pick<OrderRecord, "agentId" | "kind" | "request" | "triggerState">,
  skip: {
    readonly reason: OrderFillReason;
    readonly cap?: { readonly usedUsdMicros: bigint; readonly capUsdMicros: bigint };
    readonly book?: AddressBook;
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
    parts: {
      orderKind: skipOrderPart(order, skip.book ?? []),
      reason: { key: `reason.${reason}`, values },
    },
  };
}
