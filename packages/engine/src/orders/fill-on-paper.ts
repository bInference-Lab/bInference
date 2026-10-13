import type { ChainRegistry } from "@binference/chain";
import type { Clock, IdSource } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import { isFillAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { PaperFill } from "../intents/event-cause.schema.js";
import { assetsDocument } from "../intents/intent-documents.schema.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import type { PaperFills } from "../paper/paper-fills.js";
import type { PaperPortfolio } from "../paper/paper-portfolio.js";
import { exitEndMovesOf, fillRowNotices } from "./end-exit-orders.js";
import { cancelFill } from "./fill-ends.js";
import type { OrderFillWrite } from "./order-fill.js";
import { moveOrder } from "./order-machine.js";
import { isExitOrder, type OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

/** What an order's paper fill writes through and reads its position from. */
export interface FillOnPaperParts {
  readonly paper: PaperFills;
  readonly stored: StoredIntents;
  readonly clock: Clock;
  readonly orders: OrderStore;
  /** What each wallet holds on paper now, which tells whether a sale empties its position. */
  readonly portfolio: Pick<PaperPortfolio, "balance">;
  readonly chains: ChainRegistry;
  readonly ids: IdSource;
}

// A fill whose move lost its race to another write of its order is tried again this many times.
const fillAttempts = 3;

// Whether a sale of an exit order leaves its position holding none of the token.
async function empties(
  parts: FillOnPaperParts,
  order: OrderRecord,
  call: { readonly fill: PaperFill; readonly signal: AbortSignal },
): Promise<boolean> {
  const { fill, signal } = call;
  if (!isExitOrder(order.request) || fill.amountIn.asset !== order.request.token) {
    return false;
  }
  const held = await parts.portfolio.balance(order.walletId, order.request.token, { signal });
  return held <= fill.amountIn.base;
}

// The order records the fill at the fill's own time; an order that cannot, as one that expired
// since the check, takes no write (decision 0197). A sale that empties its position ends the
// position's other exit orders; the fill's row is `filled` and carries what the owner hears.
async function fillWriteOf(
  parts: FillOnPaperParts,
  snapshot: IntentSnapshot,
  call: {
    readonly order: OrderRecord;
    readonly fill: PaperFill;
    readonly decimals?: number;
    readonly assets: AssetInfos;
    readonly signal: AbortSignal;
  },
): Promise<OrderFillWrite | undefined> {
  const { order, fill, signal } = call;
  const emptiesPosition = await empties(parts, order, { fill, signal });
  const recorded = moveOrder(order, { type: "fill_recorded", emptiesPosition }, fill.atMs);
  if (!recorded.ok) {
    return undefined;
  }
  const ended = emptiesPosition
    ? await exitEndMovesOf(parts, { emptiedBy: order, nowMs: fill.atMs, signal })
    : [];
  const notices = fillRowNotices(parts, { ...call, ended: ended.length });
  const row = {
    id: parts.ids.next("fil"),
    orderId: order.id,
    intentId: snapshot.record.id,
    outcome: "filled" as const,
    atMs: fill.atMs,
    ...(notices.length === 0 ? {} : { notices }),
  };
  return { moves: [recorded.value, ...ended], fill: row };
}

// One try at the paper fill with its order's write; answers the intent after it, and whether the
// sold asset had a usable price.
async function tryFill(
  parts: FillOnPaperParts,
  snapshot: IntentSnapshot,
  call: {
    readonly order: OrderRecord;
    readonly decimals?: number;
    readonly assets: AssetInfos;
    readonly signal: AbortSignal;
  },
): Promise<{ readonly filled: IntentSnapshot; readonly wasPriced: boolean }> {
  const { signal } = call;
  // The paper fill asks for the order's write only once it priced the sold asset.
  const priced: true[] = [];
  const filled = await parts.paper.fillAtQuote(snapshot, {
    signal,
    order: async (fill) => {
      priced.push(true);
      return fillWriteOf(parts, snapshot, { ...call, fill });
    },
  });
  return { filled, wasPriced: priced.length > 0 };
}

// What the order's card stored of the tokens the registry does not list, for its fill notice.
async function cardAssetsOf(
  parts: FillOnPaperParts,
  order: OrderRecord,
  signal: AbortSignal,
): Promise<AssetInfos> {
  const card = await parts.stored.snapshot(order.intentId, { signal });
  const stored = card?.record.assets;
  return stored === undefined ? {} : assetsDocument.decode(stored);
}

// The order an order fill's intent fills, as it stands now.
async function orderOf(
  parts: FillOnPaperParts,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<OrderRecord | undefined> {
  const { authorizedBy } = snapshot.stored.status;
  const isOrderFill =
    authorizedBy !== undefined && isFillAuthorization(authorizedBy) && "order" in authorizedBy;
  return isOrderFill ? parts.orders.get(authorizedBy.order, { signal }) : undefined;
}

/**
 * The execute step of an auto order's confirmed paper fill (decision 0195): the intent fills at its
 * confirmed quote, and in the same write its order records the fill, the fill's `order_fills` row
 * is added, and a sale that empties its position ends the position's other exit orders, which the
 * owner hears of in one `notice.ordersEnded`. A fill whose order can no longer record it, as one
 * that expired or ended since the fill's authorization, or at the fill's own time, is cancelled
 * unsigned and fills nothing (decision 0197). A fill still `confirmed` after a try, because its
 * write lost a race to another write of its order or its sold asset had no usable price, is tried
 * again on what it reads then, up to three tries in all. Any other intent comes back as it was.
 */
export function createFillOnPaper(parts: FillOnPaperParts): ExecuteConfirmed {
  const attempt = async (
    snapshot: IntentSnapshot,
    call: {
      readonly signal: AbortSignal;
      readonly left: number;
      readonly decimals?: number;
      readonly wasPriced?: boolean;
    },
  ): Promise<IntentSnapshot> => {
    const { signal, left } = call;
    const order = await orderOf(parts, snapshot, signal);
    if (order === undefined || snapshot.record.state !== "confirmed") {
      return snapshot;
    }
    if (!moveOrder(order, { type: "fill_recorded" }, parts.clock.now()).ok) {
      return cancelFill(parts, { snapshot, signal });
    }
    // After the last try, only the check above runs, and a fill still waiting is cancelled: one
    // whose sold asset had no usable price is a skip, `no_price`.
    if (left <= 0) {
      const skip = call.wasPriced === true ? {} : { skip: { order, reason: "no_price" as const } };
      return cancelFill(parts, { snapshot, ...skip, signal });
    }
    const decimals = call.decimals === undefined ? {} : { decimals: call.decimals };
    const assets = await cardAssetsOf(parts, order, signal);
    const tried = await tryFill(parts, snapshot, { order, ...decimals, assets, signal });
    return tried.filled.record.state === "confirmed"
      ? attempt(tried.filled, { ...call, left: left - 1, wasPriced: tried.wasPriced })
      : tried.filled;
  };
  return async (snapshot, { signal, fill }) =>
    attempt(snapshot, {
      signal,
      left: fillAttempts,
      ...(fill === undefined ? {} : { decimals: fill.decimals }),
    });
}
