import { err, ok, type Result } from "@binference/core";
import type { PositionStore } from "../ports.js";
import type { ArrivalRecord, ArrivalWrite } from "../positions/arrival-record.js";
import type { ExecutionQuery, ExecutionRecord } from "../positions/execution-record.js";
import type {
  ExecutionWrite,
  PositionKey,
  PositionRecord,
  PositionWrite,
} from "../positions/position-record.js";
import { constraintFault, memoryCall } from "./memory-call.js";

type Positions = Map<string, PositionRecord>;

// What a query filters an execution or an arrival on.
type Listed = Pick<ExecutionRecord, "id" | "walletId" | "isPaper" | "atMs">;

const keyOf = (key: PositionKey): string => `${key.walletId} ${key.asset} ${String(key.isPaper)}`;

function isCurrent(positions: Positions, write: PositionWrite): boolean {
  // No row and no version read, or the row at the version read.
  return positions.get(keyOf(write.position))?.version === write.readVersion;
}

function matches(query: ExecutionQuery, row: Listed): boolean {
  return (
    row.id > query.after &&
    row.isPaper === query.isPaper &&
    (query.walletId === undefined || row.walletId === query.walletId) &&
    (query.fromMs === undefined || row.atMs >= query.fromMs) &&
    (query.toMs === undefined || row.atMs <= query.toMs)
  );
}

const pageOf = <Row extends Listed>(rows: readonly Row[], query: ExecutionQuery): Row[] =>
  structuredClone(rows.filter((row) => matches(query, row)).slice(0, query.limit));

/**
 * Creates an empty in-memory {@link PositionStore} for tests. It keeps every row until it is
 * dropped, and checks a whole write before it changes anything.
 */
export function createMemoryPositionStore(): PositionStore {
  const positions: Positions = new Map();
  const executions: ExecutionRecord[] = [];
  const arrivals: ArrivalRecord[] = [];
  // Moves every position of a write, or none and answers false when one of them is stale.
  const move = (writes: readonly PositionWrite[]): boolean => {
    if (new Set(writes.map((change) => keyOf(change.position))).size < writes.length) {
      throw constraintFault("one write moves the same position twice");
    }
    if (!writes.every((change) => isCurrent(positions, change))) {
      return false;
    }
    for (const { position, readVersion } of writes) {
      const version = readVersion === undefined ? 0 : readVersion + 1;
      positions.set(keyOf(position), { ...structuredClone(position), version });
    }
    return true;
  };
  const record = (write: ExecutionWrite): Result<ExecutionRecord, "stale"> => {
    if (!move(write.positions)) {
      return err("stale");
    }
    const execution = { ...structuredClone(write.execution), id: executions.length + 1 };
    executions.push(execution);
    return ok(structuredClone(execution));
  };
  const recordArrival = (write: ArrivalWrite): Result<ArrivalRecord, "stale"> => {
    if (!move(write.positions)) {
      return err("stale");
    }
    const arrival = { ...structuredClone(write.arrival), id: arrivals.length + 1 };
    arrivals.push(arrival);
    return ok(structuredClone(arrival));
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
    executions: async (query, call) => memoryCall(call, () => pageOf(executions, query)),
    recordArrival: async (write, call) => memoryCall(call, () => recordArrival(write)),
    arrivals: async (query, call) => memoryCall(call, () => pageOf(arrivals, query)),
  };
}
