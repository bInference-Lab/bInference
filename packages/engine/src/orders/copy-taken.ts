import type { ChainRegistry } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { IntentStore } from "../ports.js";
import type { CopyOrder } from "./copy-fills.js";
import { copyStateOf, type CopyTaking } from "./copy-state.js";
import { isLineHeld } from "./fill-faults.js";
import type { OrderStore } from "./ports.js";

/** What finding a lost take reads: the order's rows and its agent's live fills in flight. */
export interface TakenParts {
  readonly orders: Pick<OrderStore, "fills">;
  readonly intents: Pick<IntentStore, "fillsInFlight">;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

/**
 * The trade a copy order took whose fill a stop cut off (decision 0260): no row of the order since
 * it was taken, and no live fill of its agent still on its way to one. `undefined` when the order
 * took none, or its take ended in a row or still runs.
 */
export async function lostTakeOf(
  parts: TakenParts,
  order: CopyOrder,
  signal: AbortSignal,
): Promise<CopyTaking | undefined> {
  const taking = copyStateOf(order.triggerState)?.taking;
  if (taking === undefined) {
    return undefined;
  }
  const [newest] = await parts.orders.fills({ orderId: order.id, limit: 1 }, { signal });
  if (newest !== undefined && newest.atMs >= taking.takenAtMs) {
    return undefined;
  }
  return (await isLineHeld(parts, order, signal)) ? undefined : taking;
}
