import type { ChainRegistry } from "@binference/chain";
import type { Clock, IdSource } from "@binference/core";
import { isFillAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { PaperFill } from "../intents/event-cause.schema.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import type { PaperFills } from "../paper/paper-fills.js";
import type { PaperPortfolio } from "../paper/paper-portfolio.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { cancelCard } from "./cancel-order.js";
import { announceEndedExits, exitEndMovesOf } from "./end-exit-orders.js";
import type { OrderFillWrite } from "./order-fill.js";
import { moveOrder } from "./order-machine.js";
import { isExitOrder, type OrderMove, type OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

/** What an order's paper fill writes through, reads its position from, and announces on. */
export interface FillOnPaperParts {
  readonly paper: PaperFills;
  readonly stored: StoredIntents;
  readonly clock: Clock;
  readonly orders: OrderStore;
  /** What each wallet holds on paper now, which tells whether a sale empties its position. */
  readonly portfolio: Pick<PaperPortfolio, "balance">;
  readonly chains: ChainRegistry;
  readonly ids: IdSource;
  readonly publish: PublishPush;
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

/** A fill's write on its order, and the other exit orders it ends with it. */
interface FillWrite {
  readonly write: OrderFillWrite;
  readonly ended: readonly OrderMove[];
}

// The order records the fill, unless it ended meanwhile; a sale that empties its position ends
// the position's other exit orders; the fill's row is `filled`.
async function fillWriteOf(
  parts: FillOnPaperParts,
  snapshot: IntentSnapshot,
  call: { readonly order: OrderRecord; readonly fill: PaperFill; readonly signal: AbortSignal },
): Promise<FillWrite> {
  const { order, fill, signal } = call;
  const recorded = moveOrder(order, { type: "fill_recorded" }, fill.atMs);
  const ended = (await empties(parts, order, { fill, signal }))
    ? await exitEndMovesOf(parts, { emptiedBy: order, nowMs: fill.atMs, signal })
    : [];
  const row = {
    id: parts.ids.next("fil"),
    orderId: order.id,
    intentId: snapshot.record.id,
    outcome: "filled" as const,
    atMs: fill.atMs,
  };
  const moves = recorded.ok ? [recorded.value, ...ended] : ended;
  return { write: { moves, fill: row }, ended };
}

// One try at the paper fill with its order's write; answers the intent after it.
async function tryFill(
  parts: FillOnPaperParts,
  snapshot: IntentSnapshot,
  call: { readonly order: OrderRecord; readonly signal: AbortSignal },
): Promise<IntentSnapshot> {
  const { order, signal } = call;
  const written: { value?: FillWrite } = {};
  const filled = await parts.paper.fillAtQuote(snapshot, {
    signal,
    order: async (fill) => {
      written.value = await fillWriteOf(parts, snapshot, { order, fill, signal });
      return written.value.write;
    },
  });
  if (filled.record.state === "paper_filled" && written.value !== undefined) {
    announceEndedExits(parts, { emptiedBy: order, count: written.value.ended.length });
  }
  return filled;
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
 * that expired or ended since the fill's authorization, is cancelled unsigned and fills nothing.
 * A fill still `confirmed` after a try, because its
 * write lost a race to another write of its order or its sold asset had no usable price, is tried
 * again on what it reads then, up to three tries in all. Any other intent comes back as it was.
 */
export function createFillOnPaper(parts: FillOnPaperParts): ExecuteConfirmed {
  const attempt = async (
    snapshot: IntentSnapshot,
    call: { readonly signal: AbortSignal; readonly left: number },
  ): Promise<IntentSnapshot> => {
    const { signal, left } = call;
    const order = await orderOf(parts, snapshot, signal);
    if (order === undefined || snapshot.record.state !== "confirmed") {
      return snapshot;
    }
    if (!moveOrder(order, { type: "fill_recorded" }, parts.clock.now()).ok) {
      await cancelCard(parts, snapshot.record.id, signal);
      return (await parts.stored.snapshot(snapshot.record.id, { signal })) ?? snapshot;
    }
    const filled = await tryFill(parts, snapshot, { order, signal });
    return filled.record.state !== "confirmed" || left <= 1
      ? filled
      : attempt(filled, { signal, left: left - 1 });
  };
  return async (snapshot, { signal }) => attempt(snapshot, { signal, left: fillAttempts });
}
