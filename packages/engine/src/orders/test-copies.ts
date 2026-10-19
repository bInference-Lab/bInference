import type { Id } from "@binference/core";
import type { TestEngine } from "../operations/test-engine.js";
import {
  copyStateDocument,
  copyStateOf,
  type CopyState,
  type CopyTaking,
  takenState,
} from "./copy-state.js";
import { moveOrder } from "./order-machine.js";
import { storedOrder } from "./test-orders.js";

const live = { signal: new AbortController().signal };

/** A copy order's state as the store keeps it now, which must read. */
export async function copyStateNow(test: TestEngine, order: Id<"ord">): Promise<CopyState> {
  const state = copyStateOf((await storedOrder(test, order)).triggerState);
  if (state === undefined) {
    throw new Error(`Expected order ${order} to keep a copy state.`);
  }
  return state;
}

// Writes a copy order's take of a leader's trade, as its runner does before the trade's fill.
async function takeTrade(test: TestEngine, order: Id<"ord">, taking: CopyTaking): Promise<void> {
  const read = await storedOrder(test, order);
  const state = await copyStateNow(test, order);
  const triggerState = copyStateDocument.encode(takenState(state, taking));
  const move = moveOrder(read, { type: "trigger_kept", triggerState }, test.clock.now());
  const written = move.ok ? await test.stores.orders.move([move.value], live) : undefined;
  if (written?.ok !== true) {
    throw new Error(`Expected order ${order} to take trade ${String(taking.id)}.`);
  }
}

/** Takes a leader's trade for a copy order and runs its fill, answering what the fill came to. */
export async function copyTrade(
  test: TestEngine,
  order: Id<"ord">,
  taking: CopyTaking,
): Promise<string> {
  await takeTrade(test, order, taking);
  return test.engine.fillOrder({ order, price: { decimals: 0 } }, live);
}
