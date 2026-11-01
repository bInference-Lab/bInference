import type { BridgeDeliveryState, BridgeMove, BridgeRecord } from "./bridge-record.js";

// The states each move takes a bridge from.
const movesFrom: Readonly<Record<BridgeMove["to"], readonly BridgeDeliveryState[]>> = {
  late: ["in_transit"],
  delivered: ["in_transit", "late"],
  refunded: ["in_transit", "late"],
};

/**
 * A bridge after one move, or `undefined` when the move does not apply to it: its version is not
 * the move's, or its state does not take the move. Both stores write a bridge's move through this
 * rule.
 */
export function movedBridge(bridge: BridgeRecord, move: BridgeMove): BridgeRecord | undefined {
  if (bridge.version !== move.expectedVersion || !movesFrom[move.to].includes(bridge.state)) {
    return undefined;
  }
  const moved = { ...bridge, checkedAtMs: move.atMs, version: bridge.version + 1 };
  if (move.to === "late") {
    return { ...moved, state: "late", lateAtMs: move.atMs };
  }
  const settled = { ...moved, received: move.received, settledAtMs: move.atMs };
  return move.to === "delivered"
    ? { ...settled, state: "delivered", fillTx: move.fillTx }
    : { ...settled, state: "refunded", refundTx: move.refundTx };
}
