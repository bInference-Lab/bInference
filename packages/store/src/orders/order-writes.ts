// The order state machine's store adapter: the one file that writes orders.state. Every write
// runs inside one store task's transaction: it reads every row it decides on first, answers an
// expected refusal before it writes anything, and throws on a broken rule, which rolls it back.
import type { DatabaseSync } from "node:sqlite";
import { BinferenceError, err, type Id, ok, type Result } from "@binference/core";
import {
  countsLandedFill,
  isOrderEnded,
  type OrderDraft,
  type OrderMove,
  type OrderMoveRefusal,
  type OrderRecord,
} from "@binference/engine/orders";
import type { Selectable, Updateable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type { OrdersTable } from "../databases/order-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { optionalJsonText, orNull } from "../rows/column-values.js";
import { requestText, toOrderRecord } from "./order-rows.js";

function refused(message: string, details: Readonly<Record<string, string>>): BinferenceError {
  return new BinferenceError({ code: "store.constraint", message, details });
}

function orderRow(database: DatabaseSync, id: string): Selectable<OrdersTable> | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  return takeFirst(kysely.selectFrom("orders").selectAll().where("id", "=", id));
}

/** Reads one order, or `undefined`. */
export function readOrder(database: DatabaseSync, id: Id<"ord">): OrderRecord | undefined {
  const row = orderRow(database, id);
  return row === undefined ? undefined : toOrderRecord(row);
}

function isAgentFrozen(database: DatabaseSync, agentId: string): boolean | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const agent = takeFirst(
    kysely.selectFrom("agents").select("frozen_at").where("id", "=", agentId),
  );
  return agent === undefined ? undefined : agent.frozen_at !== null;
}

/**
 * Stores a new order `awaiting_confirmation`. An id in use is `exists`, a frozen agent `frozen`;
 * an unknown agent or a wallet that is not the agent's throws.
 */
export function createOrder(
  database: DatabaseSync,
  draft: OrderDraft,
): Result<OrderRecord, "exists" | "frozen"> {
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const isFrozen = isAgentFrozen(database, draft.agentId);
  const wallet = takeFirst(
    kysely.selectFrom("wallets").select("agent_id").where("id", "=", draft.walletId),
  );
  if (isFrozen === undefined || wallet?.agent_id !== draft.agentId) {
    throw refused("An order names an unknown agent or another agent's wallet.", {
      order: draft.id,
    });
  }
  if (orderRow(database, draft.id) !== undefined) {
    return err("exists");
  }
  if (isFrozen) {
    return err("frozen");
  }
  execute(
    kysely.insertInto("orders").values({
      id: draft.id,
      agent_id: draft.agentId,
      wallet_id: draft.walletId,
      kind: draft.request.kind,
      state: "awaiting_confirmation",
      request: requestText(draft.request),
      trigger_state: null,
      fills: 0,
      max_fills: orNull(draft.maxFills),
      expires_at: draft.expiresAtMs,
      intent_id: draft.intentId,
      card_id: null,
      paper: draft.isPaper ? 1 : 0,
      outside_content: draft.hasOutsideContent ? 1 : 0,
      end_reason: null,
      expiry_noticed_at: null,
      created_at: draft.atMs,
      changed_at: draft.atMs,
      version: 0,
    }),
  );
  return ok(toOrderRecord(requireRow(database, draft.id)));
}

function requireRow(database: DatabaseSync, id: string): Selectable<OrdersTable> {
  const row = orderRow(database, id);
  if (row === undefined) {
    throw refused("An order did not read back after its write.", { order: id });
  }
  return row;
}

// A move into `active` needs the confirmation of the order's card on its `autoOrder` intent, and
// an agent that is not frozen, or one the same write unfreezes.
function activeRefusal(
  database: DatabaseSync,
  check: {
    readonly row: Selectable<OrdersTable>;
    readonly move: OrderMove;
    readonly unfrozen: ReadonlySet<string>;
  },
): OrderMoveRefusal | undefined {
  const { row, move, unfrozen } = check;
  if (move.state !== "active") {
    return undefined;
  }
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const card = move.cardId ?? row.card_id;
  const confirmation = takeFirst(
    kysely.selectFrom("confirmations").select("card_id").where("intent_id", "=", row.intent_id),
  );
  if (card === null || confirmation?.card_id !== card) {
    return "not_confirmed";
  }
  const isFrozen = isAgentFrozen(database, row.agent_id) === true && !unfrozen.has(row.agent_id);
  return isFrozen ? "frozen" : undefined;
}

function checkRules(row: Selectable<OrdersTable>, move: OrderMove): void {
  const order = toOrderRecord(row);
  // Only a live fill that landed after its order ended still counts on it (decision 0210).
  if (isOrderEnded(order.state) && !countsLandedFill(order, move)) {
    throw refused("An order that ended never moves again.", { order: row.id });
  }
  if (move.endReason !== undefined && move.state !== "ended") {
    throw refused("An order takes an end reason only as it ends.", { order: row.id });
  }
}

/**
 * Checks order moves before anything is written: an unknown order is `not_found`, one at another
 * version `stale`, and a move into `active` without the confirmation of its card `not_confirmed`,
 * or of a frozen agent's order `frozen`. An agent in `unfrozen`, which the same write unfreezes,
 * counts as not frozen. A move out of an ended state, an end reason on another state, or two moves
 * of one order throw.
 */
export function checkOrderMoves(
  database: DatabaseSync,
  moves: readonly OrderMove[],
  unfrozen: ReadonlySet<string> = new Set(),
): Result<readonly OrderMove[], OrderMoveRefusal> {
  if (new Set(moves.map(({ id }) => id)).size !== moves.length) {
    throw refused("One write moves an order twice.", {});
  }
  for (const move of moves) {
    const row = orderRow(database, move.id);
    if (row === undefined) {
      return err("not_found");
    }
    if (row.version !== move.expectedVersion) {
      return err("stale");
    }
    checkRules(row, move);
    const refusal = activeRefusal(database, { row, move, unfrozen });
    if (refusal !== undefined) {
      return err(refusal);
    }
  }
  return ok(moves);
}

function changeOf(move: OrderMove): Updateable<OrdersTable> {
  const { cardId, endReason, fills, triggerState, expiryNoticedAtMs } = move;
  return {
    state: move.state,
    changed_at: move.atMs,
    ...(cardId === undefined ? {} : { card_id: cardId }),
    ...(endReason === undefined ? {} : { end_reason: endReason }),
    ...(fills === undefined ? {} : { fills }),
    ...(triggerState === undefined ? {} : { trigger_state: optionalJsonText(triggerState) }),
    ...(expiryNoticedAtMs === undefined ? {} : { expiry_noticed_at: expiryNoticedAtMs }),
  };
}

/**
 * Writes moves `checkOrderMoves` passed, each under the version its mover read, and answers the
 * orders after them in the moves' order.
 */
export function writeOrderMoves(
  database: DatabaseSync,
  moves: readonly OrderMove[],
): readonly OrderRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  return moves.map((move) => {
    const written = execute(
      kysely
        .updateTable("orders")
        .set((row) => ({ ...changeOf(move), version: row("version", "+", 1) }))
        .where("id", "=", move.id)
        .where("version", "=", move.expectedVersion),
    );
    if (written.numAffectedRows !== 1n) {
      throw refused("An order changed inside the write that read it.", { order: move.id });
    }
    return toOrderRecord(requireRow(database, move.id));
  });
}
