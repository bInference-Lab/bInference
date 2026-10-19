import type { Id } from "@binference/core";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { CapUse } from "./copy-fills.js";
import { announceOrder, type CancelFillParts, skipRowOf } from "./fill-ends.js";
import type { OrderFillsParts } from "./fill-orders.js";
import { agentWideReasons } from "./fill-pacing.js";
import type { OrderFillReason } from "./order-fill.js";
import type { OrderRecord } from "./order-record.js";

/** What the order fills keep between runs: orders under way, agents' lines, reasons told. */
export interface FillState {
  readonly running: Set<Id<"ord">>;
  readonly lines: Map<Id<"agt">, Promise<void>>;
  /** The agent-wide reasons each agent heard since its last fill or the engine's start. */
  readonly told: Map<Id<"agt">, Set<OrderFillReason>>;
}

/** One skip before any intent: its order, its reason, and the signal of its run. */
export interface Skip {
  readonly order: OrderRecord;
  readonly reason: OrderFillReason;
  /** What a copy order's buys used of the daily cap it would pass, and the cap (decision 0260). */
  readonly cap?: CapUse;
  readonly signal: AbortSignal;
}

/** The parts a skip's row and a fill's cancel are written with. */
export function rowParts(parts: OrderFillsParts): CancelFillParts {
  const { orders, ids, stored, clock, gate } = parts;
  const spent: CapGate["spent"] = async (snapshot, call) => gate.spent(snapshot, call);
  return { orders, ids, stored, clock, spent };
}

// An agent-wide reason is heard once per agent until one of its orders fills (decision 0197);
// `undefined` for a reason of the order's own, heard once in a row.
function agentWideTells(state: FillState, skipped: Skip): boolean | undefined {
  const { order, reason } = skipped;
  if (!agentWideReasons.has(reason)) {
    return undefined;
  }
  const heard = state.told.get(order.agentId) ?? new Set<OrderFillReason>();
  const isNew = !heard.has(reason);
  state.told.set(order.agentId, heard.add(reason));
  return isNew;
}

/**
 * Stores a skip of an order's fill before any intent, with its notice in the same write, and
 * tells the owner (decision 0197); the order stays as it is. A copy order's skip names its leader
 * as the agent's address book does.
 */
export async function skipFill(
  parts: OrderFillsParts,
  state: FillState,
  skipped: Skip,
): Promise<"skipped"> {
  const { order, reason, signal, cap } = skipped;
  const tells = agentWideTells(state, skipped);
  const atMs = parts.clock.now();
  const told = tells === undefined ? {} : { tells };
  const settings =
    order.kind === "copy" ? await parts.agents.get(order.agentId, { signal }) : undefined;
  const book = settings === undefined ? {} : { book: settings.addressBook };
  const call = {
    order,
    reason,
    atMs,
    signal,
    ...told,
    ...book,
    ...(cap === undefined ? {} : { cap }),
  };
  const row = await skipRowOf(rowParts(parts), call);
  await parts.orders.recordFill(row, { signal });
  await announceOrder(parts, order.id, signal);
  return "skipped";
}
