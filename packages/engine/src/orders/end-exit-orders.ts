import { assetRefParts, type AssetRef, type ChainRegistry } from "@binference/chain";
import type { Id, JsonValue } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import type { PaperFill } from "../intents/event-cause.schema.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { PositionStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { type Notice, noticePush } from "../pushes/notice-push.js";
import { fillNotice } from "./fill-notices.js";
import { moveOrder } from "./order-machine.js";
import {
  isExitOrder,
  type OrderMove,
  type OrderPosition,
  type OrderRecord,
  positionOf,
} from "./order-record.js";
import { orderPush } from "./order-view-of.js";
import type { OrderStore } from "./ports.js";

/** What ending exit orders reads and writes through, and where its pushes go. */
export interface ExitParts {
  readonly orders: OrderStore;
  readonly chains: ChainRegistry;
  readonly publish: PublishPush;
}

// How many orders of one wallet and mode the end reads; more than any position holds.
const pageSize = 1_000;

function isOnPosition(order: OrderRecord, position: OrderPosition): boolean {
  const own = positionOf(order);
  return (
    own.walletId === position.walletId &&
    own.token === position.token &&
    own.isPaper === position.isPaper &&
    isExitOrder(order.request)
  );
}

// The moves that end every active or paused exit order of a position but `except`, with the end
// reason `position_closed` (spec 6, section 5).
function exitEndMoves(
  orders: readonly OrderRecord[],
  position: OrderPosition,
  call: { readonly except?: Id<"ord">; readonly nowMs: number },
): readonly OrderMove[] {
  return orders
    .filter((order) => order.id !== call.except && isOnPosition(order, position))
    .flatMap((order) => {
      const move = moveOrder(order, { type: "position_closed" }, call.nowMs);
      return move.ok ? [move.value] : [];
    });
}

// The token as a notice names it: its symbol from the registry, else its address.
function tokenText(chains: ChainRegistry, token: AssetRef): string {
  return assetInfoOf(chains, token)?.symbol ?? assetRefParts(token).assetReference;
}

async function runningOn(
  parts: Pick<ExitParts, "orders">,
  position: OrderPosition,
  signal: AbortSignal,
): Promise<readonly OrderRecord[]> {
  const { walletId, isPaper } = position;
  const query = { states: ["active", "paused"] as const, walletId, isPaper, limit: pageSize };
  return parts.orders.list(query, { signal });
}

/**
 * The moves that end the other exit orders of the position an exit order's fill empties (spec 6,
 * section 5): each active or paused exit order of its wallet, token and mode but the order itself
 * moves to `ended` with `position_closed`. The fill writes them in its own transaction.
 */
export async function exitEndMovesOf(
  parts: Pick<ExitParts, "orders">,
  call: { readonly emptiedBy: OrderRecord; readonly nowMs: number; readonly signal: AbortSignal },
): Promise<readonly OrderMove[]> {
  const { emptiedBy, nowMs, signal } = call;
  const position = positionOf(emptiedBy);
  const running = await runningOn(parts, position, signal);
  return exitEndMoves(running, position, { except: emptiedBy.id, nowMs });
}

/**
 * The one `notice.ordersEnded` that tells the owner of the other exit orders an exit order's fill
 * ended as it emptied their position; none when it ended none.
 */
export function endedExitsNotice(
  parts: Pick<ExitParts, "chains">,
  call: { readonly emptiedBy: OrderRecord; readonly count: number },
): Notice | undefined {
  const { emptiedBy, count } = call;
  if (count === 0) {
    return undefined;
  }
  const orderKind = { key: "order.kind", values: { kind: emptiedBy.kind } };
  const token = tokenText(parts.chains, emptiedBy.request.token);
  const values = { token, count: String(count) };
  return { key: "notice.ordersEnded", agent: emptiedBy.agentId, values, parts: { orderKind } };
}

/**
 * Ends one exit order whose trigger fired on a position that holds none of the token, because a
 * sale outside the exit orders emptied it (spec 6, section 5): it moves to `ended` with
 * `position_closed` instead of being skipped at each new price, and the owner gets
 * `notice.exitEnded`. Answers the order after it, or `undefined` when another write moved it first.
 */
export async function endEmptyExit(
  parts: ExitParts,
  call: { readonly order: OrderRecord; readonly nowMs: number; readonly signal: AbortSignal },
): Promise<OrderRecord | undefined> {
  const { order, nowMs, signal } = call;
  const move = moveOrder(order, { type: "position_closed" }, nowMs);
  const written = move.ok ? await parts.orders.move([move.value], { signal }) : undefined;
  const [ended] = written?.ok === true ? written.value : [];
  if (ended !== undefined) {
    parts.publish(orderPush(ended, "order/changed"));
    const values = { token: tokenText(parts.chains, order.request.token) };
    const orderKind = { key: "order.kind", values: { kind: order.kind } };
    parts.publish(
      noticePush({ key: "notice.exitEnded", agent: order.agentId, values, parts: { orderKind } }),
    );
  }
  return ended;
}

/**
 * Whether a sale emptied an exit order's position after the order was made (decision 0197): its
 * position holds none of the token now and last changed at or after the order's creation, so it
 * held some since. A position never held while the order lived, as one whose buy has not settled,
 * was not emptied, and its exit order waits.
 */
export async function wasEmptiedSince(
  positions: Pick<PositionStore, "positions">,
  call: { readonly order: OrderRecord; readonly signal: AbortSignal },
): Promise<boolean> {
  const { order, signal } = call;
  const query = { walletId: order.walletId, isPaper: order.isPaper };
  const held = await positions.positions(query, { signal });
  const position = held.find(({ asset }) => asset === order.request.token);
  return (
    position !== undefined &&
    position.quantityBase === 0n &&
    position.changedAtMs >= order.createdAtMs
  );
}

/**
 * Ends, after an exit order's fill emptied its position, each other exit order on it that became
 * active after the fill read them (decision 0197), with one `notice.ordersEnded`. A position that
 * still holds the token ends nothing; a move another write beat is left to the next price.
 */
export async function endLateExits(
  parts: ExitParts & {
    readonly positions: Pick<PositionStore, "positions">;
    readonly clock: { readonly now: () => number };
  },
  call: { readonly filled: OrderRecord; readonly signal: AbortSignal },
): Promise<void> {
  const { filled, signal } = call;
  if (!isExitOrder(filled.request)) {
    return;
  }
  const query = { walletId: filled.walletId, isPaper: filled.isPaper };
  const held = await parts.positions.positions(query, { signal });
  const position = held.find(({ asset }) => asset === filled.request.token);
  if (position?.quantityBase !== 0n) {
    return;
  }
  const nowMs = parts.clock.now();
  const moves = await exitEndMovesOf(parts, { emptiedBy: filled, nowMs, signal });
  const written = moves.length === 0 ? undefined : await parts.orders.move(moves, { signal });
  if (written?.ok !== true) {
    return;
  }
  written.value.forEach((order) => {
    parts.publish(orderPush(order, "order/changed"));
  });
  const notice = endedExitsNotice(parts, { emptiedBy: filled, count: written.value.length });
  if (notice !== undefined) {
    parts.publish(noticePush(notice));
  }
}

/**
 * What the owner hears of an order's fill, written on its row: `notice.fill`, at a whole token's
 * price, when the token's decimals and the sold asset's price are known, and the one
 * `notice.ordersEnded` of the other exit orders it ended.
 */
export function fillRowNotices(
  parts: Pick<ExitParts, "chains">,
  call: {
    readonly order: OrderRecord;
    readonly fill: PaperFill;
    readonly decimals?: number;
    readonly assets: AssetInfos;
    readonly ended: number;
  },
): readonly JsonValue[] {
  const { order, fill, decimals, assets, ended } = call;
  const { soldPrice } = fill;
  const filled =
    soldPrice === undefined || decimals === undefined
      ? undefined
      : fillNotice(order, { ...fill, soldPrice }, { decimals, assets });
  const exits = endedExitsNotice(parts, { emptiedBy: order, count: ended });
  return [filled, exits]
    .filter((notice) => notice !== undefined)
    .map((notice) => noticePush(notice).data);
}
