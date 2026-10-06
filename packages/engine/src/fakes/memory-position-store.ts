import { err, ok, type Result } from "@binference/core";
import type { PositionStore } from "../ports.js";
import type { ExecutionQuery, ExecutionRecord } from "../positions/execution-record.js";
import type {
  ExecutionWrite,
  PositionKey,
  PositionRecord,
  PositionWrite,
} from "../positions/position-record.js";
import { constraintFault, memoryCall } from "./memory-call.js";

type Positions = Map<string, PositionRecord>;

const keyOf = (key: PositionKey): string => `${key.walletId} ${key.asset} ${String(key.isPaper)}`;

function isCurrent(positions: Positions, write: PositionWrite): boolean {
  // No row and no version read, or the row at the version read.
  return positions.get(keyOf(write.position))?.version === write.readVersion;
}

function matches(query: ExecutionQuery, execution: ExecutionRecord): boolean {
  return (
    execution.id > query.after &&
    execution.isPaper === query.isPaper &&
    (query.walletId === undefined || execution.walletId === query.walletId) &&
    (query.fromMs === undefined || execution.atMs >= query.fromMs) &&
    (query.toMs === undefined || execution.atMs <= query.toMs)
  );
}

/**
 * Creates an empty in-memory {@link PositionStore} for tests. It keeps every row until it is
 * dropped, and checks a whole write before it changes anything.
 */
export function createMemoryPositionStore(): PositionStore {
  const positions: Positions = new Map();
  const executions: ExecutionRecord[] = [];
  const record = (write: ExecutionWrite): Result<ExecutionRecord, "stale"> => {
    const keys = new Set(write.positions.map((change) => keyOf(change.position)));
    if (keys.size < write.positions.length) {
      throw constraintFault("one execution writes the same position twice");
    }
    if (!write.positions.every((change) => isCurrent(positions, change))) {
      return err("stale");
    }
    for (const { position, readVersion } of write.positions) {
      const version = readVersion === undefined ? 0 : readVersion + 1;
      positions.set(keyOf(position), { ...structuredClone(position), version });
    }
    const execution = { ...structuredClone(write.execution), id: executions.length + 1 };
    executions.push(execution);
    return ok(structuredClone(execution));
  };
  return {
    positions: async (query, call) =>
      memoryCall(call, () =>
        structuredClone(
          [...positions.values()]
            .filter((row) => row.walletId === query.walletId && row.isPaper === query.isPaper)
            .toSorted((left, right) => (left.asset < right.asset ? -1 : 1)),
        ),
      ),
    record: async (write, call) => memoryCall(call, () => record(write)),
    executions: async (query, call) =>
      memoryCall(call, () =>
        structuredClone(
          executions.filter((execution) => matches(query, execution)).slice(0, query.limit),
        ),
      ),
  };
}
