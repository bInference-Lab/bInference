import { BinferenceError, err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { Proposer } from "../money-path/create-money-path.js";
import type { OrderParts } from "./create-order.js";
import { moveOrder } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";
import { orderPush } from "./order-view-of.js";

// The owner's clients and the agent runtime cancel any order; a client with `propose` alone, such
// as an MCP client, only the orders it proposed (decision 0189).
async function mayCancel(
  parts: OrderParts,
  call: { readonly order: OrderRecord; readonly canceller: Proposer; readonly signal: AbortSignal },
): Promise<boolean> {
  const { order, canceller, signal } = call;
  if (canceller.role !== "mcp_client") {
    return true;
  }
  const intent = await parts.stored.snapshot(order.intentId, { signal });
  return intent?.record.proposer === canceller.ref;
}

// An order waiting for its card takes its card with it: the intent is cancelled and the card
// closes on every surface. A card another write answered first is left to that write.
async function cancelCard(
  parts: OrderParts,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<void> {
  const snapshot = await parts.stored.snapshot(intent, { signal });
  if (snapshot === undefined) {
    return;
  }
  const machine = createIntentStateMachine({ clock: parts.clock });
  const trigger = { type: "cancel_requested", cause: "request", hasSignedStep: false } as const;
  const step = machine.apply(snapshot.stored.status, trigger);
  if (step.ok) {
    const move = { intent, version: snapshot.stored.version, step: step.value, by: "engine" };
    await parts.stored.move(move, { signal });
  }
}

/** One cancel as a client asked for it. */
interface Cancelling {
  readonly order: Id<"ord">;
  readonly canceller: Proposer;
  readonly signal: AbortSignal;
}

// A cancel reads again and writes again when another write, such as a fill or a tap, moved the
// order first; five rounds outlast any burst of moves, and a cancel never gives up quietly.
const maxRounds = 5;

async function cancelOnce(
  parts: OrderParts,
  call: Cancelling,
): Promise<Result<OrderRecord, ProtocolErrorCode | "stale">> {
  const { signal } = call;
  const order = await parts.orders.get(call.order, { signal });
  if (order === undefined) {
    return err("order.not_found");
  }
  if (!(await mayCancel(parts, { order, canceller: call.canceller, signal }))) {
    return err("auth.scope");
  }
  const move = moveOrder(order, { type: "cancel_requested" }, parts.clock.now());
  if (!move.ok) {
    return err("order.wrong_state");
  }
  const written = await parts.orders.move([move.value], { signal });
  const [cancelled] = written.ok ? written.value : [];
  if (cancelled === undefined) {
    return err("stale");
  }
  parts.publish(orderPush(cancelled, "order/changed"));
  if (order.state === "awaiting_confirmation") {
    await cancelCard(parts, order.intentId, signal);
  }
  return ok(cancelled);
}

/**
 * Cancels an auto order at once, with no card: braking (protocol spec, section 7.5). An order
 * waiting for its card, active or paused becomes `cancelled`, and a waiting one's card closes. An
 * unknown order is `order.not_found`, one that ended `order.wrong_state`, and another client's
 * order for a client with `propose` alone `auth.scope`. A cancel another write beat reads the
 * order again and tries again, five times at most.
 */
export async function cancelOrder(
  parts: OrderParts,
  call: Cancelling,
  round = 1,
): Promise<Result<OrderRecord, ProtocolErrorCode>> {
  const cancelled = await cancelOnce(parts, call);
  if (cancelled.ok) {
    return cancelled;
  }
  const { error } = cancelled;
  if (error !== "stale") {
    return err(error);
  }
  if (round >= maxRounds) {
    throw new BinferenceError({
      code: "engine.cancel_contended",
      message: `Other writes moved order ${call.order} ${String(maxRounds)} times in a row.`,
      retryable: true,
    });
  }
  return cancelOrder(parts, call, round + 1);
}
