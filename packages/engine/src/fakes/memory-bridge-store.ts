import { type Id, err, ok } from "@binference/core";
import { movedBridge } from "../bridges/bridge-move.js";
import type { BridgeCursor, BridgeMove, BridgeRecord } from "../bridges/bridge-record.js";
import type { BridgeStore } from "../bridges/ports.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/** What the in-memory bridge store checks a bridge's intent against. */
export interface MemoryBridgeStoreOptions {
  readonly hasIntent: (id: Id<"int">) => boolean;
}

// The oldest deposit first, then by intent, as the SQLite store lists them.
function byDeposit(left: BridgeRecord, right: BridgeRecord): number {
  if (left.sentAtMs !== right.sentAtMs) {
    return left.sentAtMs - right.sentAtMs;
  }
  if (left.intentId === right.intentId) {
    return 0;
  }
  return left.intentId < right.intentId ? -1 : 1;
}

// Whether the bridge comes after the cursor in the order both stores list.
function isAfter(bridge: BridgeRecord, cursor: BridgeCursor | undefined): boolean {
  return cursor === undefined || byDeposit(bridge, { ...bridge, ...cursor }) > 0;
}

// The settlement transaction a move writes, when it settles the bridge.
function settlementOf(move: BridgeMove): string | undefined {
  if (move.to === "delivered") {
    return move.fillTx;
  }
  return move.to === "refunded" ? move.refundTx : undefined;
}

// Whether another bridge holds the transaction a move settles with: a fill to the same chain, or a
// refund, as the SQLite store's unique indexes refuse.
function isTaken(bridges: ReadonlyMap<Id<"int">, BridgeRecord>, move: BridgeMove): boolean {
  const tx = settlementOf(move);
  const own = bridges.get(move.intentId);
  return [...bridges.values()].some(
    (other) =>
      other.intentId !== move.intentId &&
      tx !== undefined &&
      (move.to === "delivered"
        ? other.fillTx === tx && other.toChain === own?.toChain
        : other.refundTx === tx),
  );
}

/** Creates an in-memory {@link BridgeStore} with no bridge, for tests. */
export function createMemoryBridgeStore(options: MemoryBridgeStoreOptions): BridgeStore {
  const bridges = new Map<Id<"int">, BridgeRecord>();
  return {
    open: async (draft, call) =>
      memoryCall(call, () => {
        const held = bridges.get(draft.intentId);
        if (held !== undefined) {
          return structuredClone(held);
        }
        if (!options.hasIntent(draft.intentId)) {
          throw constraintFault("a bridge of an intent the store does not hold");
        }
        const opened: BridgeRecord = { ...structuredClone(draft), state: "in_transit", version: 0 };
        bridges.set(draft.intentId, opened);
        return structuredClone(opened);
      }),
    get: async (intentId, call) => memoryCall(call, () => structuredClone(bridges.get(intentId))),
    list: async (query, call) =>
      memoryCall(call, () =>
        [...bridges.values()]
          .filter((bridge) => query.states.includes(bridge.state) && isAfter(bridge, query.after))
          .toSorted(byDeposit)
          .slice(0, query.limit)
          .map((bridge) => structuredClone(bridge)),
      ),
    settledBy: async (tx, call) =>
      memoryCall(call, () =>
        structuredClone(
          [...bridges.values()].find((bridge) => bridge.fillTx === tx || bridge.refundTx === tx),
        ),
      ),
    move: async (move, call) =>
      memoryCall(call, () => {
        const held = bridges.get(move.intentId);
        const moved = held === undefined ? undefined : movedBridge(held, move);
        if (moved === undefined) {
          return err("stale" as const);
        }
        if (isTaken(bridges, move)) {
          return err("taken" as const);
        }
        bridges.set(move.intentId, moved);
        return ok(structuredClone(moved));
      }),
  };
}
