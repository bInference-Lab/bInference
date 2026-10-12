import { assetRefParts, type AssetRef, type ChainRegistry } from "@binference/chain";
import type { Id } from "@binference/core";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
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
  parts: ExitParts,
  position: OrderPosition,
  signal: AbortSignal,
): Promise<readonly OrderRecord[]> {
  const { walletId, isPaper } = position;
  const query = { states: ["active", "paused"] as const, walletId, isPaper, limit: pageSize };
  return parts.orders.list(query, { signal });
}

/**
 * Ends the other exit orders of the position an exit order's fill emptied (spec 6, section 5):
 * each moves to `ended` with `position_closed` in one write, and the owner gets one
 * `notice.ordersEnded` for them. A write another write beat leaves them to the next fill. Answers
 * the orders it ended.
 */
export async function endOtherExits(
  parts: ExitParts,
  call: { readonly emptiedBy: OrderRecord; readonly nowMs: number; readonly signal: AbortSignal },
): Promise<readonly OrderRecord[]> {
  const { emptiedBy, nowMs, signal } = call;
  const position = positionOf(emptiedBy);
  const running = await runningOn(parts, position, signal);
  const moves = exitEndMoves(running, position, { except: emptiedBy.id, nowMs });
  const written = moves.length === 0 ? undefined : await parts.orders.move(moves, { signal });
  const ended = written?.ok === true ? written.value : [];
  ended.forEach((order) => {
    parts.publish(orderPush(order, "order/changed"));
  });
  if (ended.length > 0) {
    const orderKind = { key: "order.kind", values: { kind: emptiedBy.kind } };
    const values = { token: tokenText(parts.chains, position.token), count: String(ended.length) };
    const notice = { key: "notice.ordersEnded", agent: emptiedBy.agentId, values };
    parts.publish(noticePush({ ...notice, parts: { orderKind } }));
  }
  return ended;
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
