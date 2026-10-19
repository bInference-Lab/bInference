import { type ChainRegistry, type PriceSource, withQuotePrice } from "@binference/chain";
import type { IdSource, JsonValue, Ratio } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { SettledTrade } from "../intents/event-cause.schema.js";
import { assetsDocument, quoteDocument } from "../intents/intent-documents.schema.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { IntentStore, PositionStore } from "../ports.js";
import { isUsablePrice } from "../positions/value-execution.js";
import { noticePush } from "../pushes/notice-push.js";
import { copyStateOf } from "./copy-state.js";
import { exitEndMovesOf, fillRowNotices } from "./end-exit-orders.js";
import type { OrderFillWrite } from "./order-fill.js";
import { moveOrder } from "./order-machine.js";
import { isExitOrder, type OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

/** What a landed live fill's write on its order reads. */
export interface LandedFillParts {
  readonly orders: OrderStore;
  /** The order's card intent, which holds what the card showed of a token the registry lacks. */
  readonly intents: Pick<IntentStore, "get">;
  /** The live positions, already holding the trade, which tell whether it emptied its position. */
  readonly positions: Pick<PositionStore, "positions">;
  readonly prices: PriceSource;
  readonly chains: ChainRegistry;
  readonly ids: IdSource;
}

/**
 * What a landed live fill moved: as its transactions settled, or, for one found late before its
 * blocks are final, its confirmed quote's input and least output (decision 0211).
 */
export type LandedTrade = Pick<SettledTrade, "amountIn" | "amountOut">;

// Whether an exit order's sale left its live position holding none of the token: none held once
// the trade is in the positions, or no more than it sold while it is not yet.
async function emptiesPosition(
  parts: LandedFillParts,
  call: {
    readonly order: OrderRecord;
    readonly settled: LandedTrade;
    readonly isBooked: boolean;
    readonly signal: AbortSignal;
  },
): Promise<boolean> {
  const { order, settled, signal } = call;
  if (!isExitOrder(order.request) || settled.amountIn.asset !== order.request.token) {
    return false;
  }
  const query = { walletId: order.walletId, isPaper: false };
  const held = await parts.positions.positions(query, { signal });
  const position = held.find(({ asset }) => asset === order.request.token);
  const left = call.isBooked ? 0n : settled.amountIn.base;
  return position !== undefined && position.quantityBase <= left;
}

/**
 * Whether counting one more fill passes the order's most fills: two of its fills landed under one
 * count, which the owner hears of at once (decision 0211).
 */
export function isOverCount(order: Pick<OrderRecord, "fills" | "maxFills">): boolean {
  return order.maxFills !== undefined && order.fills >= order.maxFills;
}

// The owner's alarm, which no setting mutes, when a landed fill passes its order's most fills.
function overCountNotice(order: OrderRecord): JsonValue {
  const values = { fills: String(order.fills + 1), maxFills: String(order.maxFills ?? 0) };
  const orderKind = { key: "order.kind", values: { kind: order.kind } };
  const notice = {
    key: "notice.orderOverfilled",
    agent: order.agentId,
    values,
    parts: { orderKind },
  };
  return noticePush(notice).data;
}

// The decimals of the token a copy order's taken trade trades: the registry's, else what it
// answered as the order took the trade; none for another order.
function copiedTokenOf(
  parts: Pick<LandedFillParts, "chains">,
  order: OrderRecord,
): { readonly decimals?: number; readonly assets: AssetInfos } | undefined {
  const taking = order.kind === "copy" ? copyStateOf(order.triggerState)?.taking : undefined;
  if (taking === undefined) {
    return undefined;
  }
  const decimals = assetInfoOf(parts.chains, taking.asset)?.decimals ?? taking.facts?.decimals;
  return decimals === undefined ? { assets: {} } : { decimals, assets: {} };
}

// The decimals of the order's token, or of the trade a copy order took: the registry's, else what
// the order's card stored of it, or what the token answered as the copy order took its trade.
async function tokenOf(
  parts: LandedFillParts,
  order: OrderRecord,
  signal: AbortSignal,
): Promise<{ readonly decimals?: number; readonly assets: AssetInfos }> {
  const copied = copiedTokenOf(parts, order);
  if (copied !== undefined) {
    return copied;
  }
  const listed = assetInfoOf(parts.chains, order.request.token);
  if (listed !== undefined) {
    return { decimals: listed.decimals, assets: {} };
  }
  const card = await parts.intents.get(order.intentId, { signal });
  const assets = card?.assets === undefined ? {} : assetsDocument.decode(card.assets);
  const decimals = assets[order.request.token]?.decimals;
  return decimals === undefined ? { assets } : { decimals, assets };
}

// The sold asset's USD price per base unit, from its feed or else the fill's own quote.
async function soldPriceOf(
  parts: LandedFillParts,
  call: {
    readonly snapshot: IntentSnapshot;
    readonly settled: LandedTrade;
    readonly signal: AbortSignal;
  },
): Promise<Ratio | undefined> {
  const { snapshot, settled, signal } = call;
  const quote = quoteDocument.decode(snapshot.record.quote ?? null);
  const price = await withQuotePrice(parts.prices, quote).usdPrice(settled.amountIn.asset, {
    signal,
  });
  return price.ok && isUsablePrice(price.value) ? price.value : undefined;
}

// What the owner hears of the fill, written on its row, with the sold asset's price and the
// token's decimals read for it.
async function noticesOf(
  parts: LandedFillParts,
  call: {
    readonly order: OrderRecord;
    readonly snapshot: IntentSnapshot;
    readonly settled: LandedTrade;
    readonly ended: number;
    readonly signal: AbortSignal;
  },
): Promise<readonly JsonValue[]> {
  const { order, settled, ended, signal } = call;
  const [token, soldPrice] = await Promise.all([
    tokenOf(parts, order, signal),
    soldPriceOf(parts, call),
  ]);
  const traded = { amountIn: settled.amountIn, amountOut: settled.amountOut, atMs: 0 };
  const fill = soldPrice === undefined ? traded : { ...traded, soldPrice };
  const decimals = token.decimals === undefined ? {} : { decimals: token.decimals };
  const book = call.snapshot.settings.addressBook;
  const notices = fillRowNotices(parts, {
    order,
    fill,
    ...decimals,
    assets: token.assets,
    ended,
    book,
  });
  return isOverCount(order) ? [...notices, overCountNotice(order)] : notices;
}

/**
 * The write on its order of a live fill that landed (decisions 0210 and 0211), stored with the
 * move that reconciles it, with its late landing's link, or alone: the order counts the fill
 * whatever it became while the fill was under way, a sale that emptied its position ends the
 * position's other exit orders, and the fill's `order_fills` row carries what the owner hears,
 * with an alarm when the count passes the order's most fills. `isBooked` says whether the trade
 * is in the positions yet. `undefined` when the order cannot take it.
 */
export async function landedFillWrite(
  parts: LandedFillParts,
  call: {
    readonly order: OrderRecord;
    readonly snapshot: IntentSnapshot;
    readonly settled: LandedTrade;
    readonly isBooked: boolean;
    readonly atMs: number;
    readonly signal: AbortSignal;
  },
): Promise<OrderFillWrite | undefined> {
  const { order, snapshot, settled, isBooked, atMs, signal } = call;
  const empties = await emptiesPosition(parts, { order, settled, isBooked, signal });
  const landed = moveOrder(order, { type: "fill_landed", emptiesPosition: empties }, atMs);
  if (!landed.ok) {
    return undefined;
  }
  const ended = empties
    ? await exitEndMovesOf(parts, { emptiedBy: order, nowMs: atMs, signal })
    : [];
  const notices = await noticesOf(parts, { ...call, ended: ended.length });
  const row = {
    id: parts.ids.next("fil"),
    orderId: order.id,
    intentId: snapshot.record.id,
    outcome: "filled" as const,
    atMs,
    ...(notices.length === 0 ? {} : { notices }),
  };
  return { moves: [landed.value, ...ended], fill: row };
}
