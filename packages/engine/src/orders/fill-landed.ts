import { type ChainRegistry, type PriceSource, withQuotePrice } from "@binference/chain";
import type { IdSource, JsonValue, Ratio } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { SettledTrade } from "../intents/event-cause.schema.js";
import { assetsDocument, quoteDocument } from "../intents/intent-documents.schema.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { IntentStore, PositionStore } from "../ports.js";
import { isUsablePrice } from "../positions/value-execution.js";
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

// Whether an exit order's sale left its live position holding none of the token; the trade is in
// the positions before the move that settles it.
async function emptiesPosition(
  parts: LandedFillParts,
  call: {
    readonly order: OrderRecord;
    readonly settled: SettledTrade;
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
  return position !== undefined && position.quantityBase === 0n;
}

// The decimals of the order's token: the registry's, else what the order's card stored of it.
async function tokenOf(
  parts: LandedFillParts,
  order: OrderRecord,
  signal: AbortSignal,
): Promise<{ readonly decimals?: number; readonly assets: AssetInfos }> {
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
    readonly settled: SettledTrade;
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
    readonly settled: SettledTrade;
    readonly ended: number;
    readonly signal: AbortSignal;
  },
): Promise<readonly JsonValue[]> {
  const { order, settled, ended, signal } = call;
  const [token, soldPrice] = await Promise.all([
    tokenOf(parts, order, signal),
    soldPriceOf(parts, call),
  ]);
  const fill = soldPrice === undefined ? settled : { ...settled, soldPrice };
  const decimals = token.decimals === undefined ? {} : { decimals: token.decimals };
  return fillRowNotices(parts, { order, fill, ...decimals, assets: token.assets, ended });
}

/**
 * The write on its order of a live fill that landed, stored with the move that reconciles it
 * (decision 0210): the order counts the fill whatever it became while the fill was under way, a
 * sale that emptied its position ends the position's other exit orders, and the fill's
 * `order_fills` row carries what the owner hears. `undefined` when the order is gone.
 */
export async function landedFillWrite(
  parts: LandedFillParts,
  call: {
    readonly order: OrderRecord;
    readonly snapshot: IntentSnapshot;
    readonly settled: SettledTrade;
    readonly atMs: number;
    readonly signal: AbortSignal;
  },
): Promise<OrderFillWrite | undefined> {
  const { order, snapshot, settled, atMs, signal } = call;
  const empties = await emptiesPosition(parts, { order, settled, signal });
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
