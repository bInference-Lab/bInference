import type { Amount } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { PositionStore } from "../ports.js";
import type { ArrivalRecord, ArrivalWrite, PaperReset } from "../positions/arrival-record.js";
import type {
  DepartureOutcome,
  DepartureRecord,
  DepartureWrite,
} from "../positions/departure-record.js";
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

// A reset touches only its own wallet's paper rows, and writes every paper position the wallet has.
function checkReset(positions: Positions, reset: PaperReset): boolean {
  const isOwn = (key: Pick<PositionKey, "walletId" | "isPaper">): boolean =>
    key.walletId === reset.walletId && key.isPaper;
  if (!reset.arrivals.every(isOwn) || !reset.positions.every((write) => isOwn(write.position))) {
    throw constraintFault("a paper reset changes only its wallet's paper rows");
  }
  const written = new Set(reset.positions.map((write) => keyOf(write.position)));
  return [...positions.values()].every((row) => !isOwn(row) || written.has(keyOf(row)));
}

// Moves every position of a write, or none and answers false when one of them is stale.
function movePositions(positions: Positions, writes: readonly PositionWrite[]): boolean {
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
}

// Moves the reset's positions and numbers its arrivals from `firstId`, or answers stale.
function resetPaper(
  positions: Positions,
  reset: PaperReset,
  firstId: number,
): Result<readonly ArrivalRecord[], "stale"> {
  if (!checkReset(positions, reset) || !movePositions(positions, reset.positions)) {
    return err("stale");
  }
  return ok(reset.arrivals.map((arrival, index) => ({ ...arrival, id: firstId + index })));
}

// An intent's departures are stored once; a second write answers the first and adds nothing.
function departOnce(
  rows: { readonly positions: Positions; readonly departures: readonly DepartureRecord[] },
  write: DepartureWrite,
): { readonly outcome: DepartureOutcome; readonly added: readonly DepartureRecord[] } {
  const earlier = rows.departures.filter(({ intentId }) => intentId === write.intentId);
  if (earlier.length > 0) {
    return { outcome: ok(earlier), added: [] };
  }
  if (write.positions.some(({ position }) => position.isPaper)) {
    throw constraintFault("a departure moves only live positions");
  }
  if (!movePositions(rows.positions, write.positions)) {
    return { outcome: err("stale"), added: [] };
  }
  const { intentId } = write;
  const firstId = rows.departures.length + 1;
  const added = write.departures.map((draft, index) => ({
    ...draft,
    intentId,
    id: firstId + index,
  }));
  return { outcome: ok(added), added };
}

const pageOf = <Row extends Listed>(rows: readonly Row[], query: ExecutionQuery): Row[] =>
  structuredClone(rows.filter((row) => matches(query, row)).slice(0, query.limit));

const isSameAmount = (left: Amount, right: Amount): boolean =>
  left.asset === right.asset && left.base === right.base;

// Whether a stored execution holds exactly what `write` would store: the same write run again
// answers it, as its first run did (decision 0413).
function holdsWrite(stored: ExecutionRecord, write: ExecutionWrite): boolean {
  const { execution: draft, realizedUsdMicros } = write;
  return [
    stored.intentId === draft.intentId,
    stored.walletId === draft.walletId,
    stored.isPaper === draft.isPaper,
    stored.atMs === draft.atMs,
    isSameAmount(stored.sold, draft.sold),
    stored.feeBase === draft.feeBase,
    isSameAmount(stored.bought, draft.bought),
    isSameAmount(stored.gas, draft.gas),
    stored.txHash === draft.txHash,
    stored.valueUsdMicros === draft.valueUsdMicros,
    stored.feeUsdMicros === draft.feeUsdMicros,
    stored.gasUsdMicros === draft.gasUsdMicros,
    stored.realizedUsdMicros === realizedUsdMicros,
  ].every(Boolean);
}

// Whether a position holds what `write` set, at the version after the one it read.
function holdsPositionWrite(positions: Positions, write: PositionWrite): boolean {
  const { position, readVersion } = write;
  const row = positions.get(keyOf(position));
  return (
    row !== undefined &&
    [
      row.version === (readVersion === undefined ? 0 : readVersion + 1),
      row.quantityBase === position.quantityBase,
      row.costUsdMicros === position.costUsdMicros,
      row.realizedUsdMicros === position.realizedUsdMicros,
      row.changedAtMs === position.changedAtMs,
    ].every(Boolean)
  );
}

// Moves an execution's positions and answers the execution to add, or the one the same write
// stored while its positions still hold what it set, which adds nothing.
function recordExecution(
  rows: { readonly positions: Positions; readonly executions: readonly ExecutionRecord[] },
  write: ExecutionWrite,
): {
  readonly outcome: Result<ExecutionRecord, "stale">;
  readonly added: readonly ExecutionRecord[];
} {
  const { positions, executions } = rows;
  const isLeftAsWritten = write.positions.every((change) => holdsPositionWrite(positions, change));
  const replayed = isLeftAsWritten
    ? executions.find((stored) => holdsWrite(stored, write))
    : undefined;
  if (replayed !== undefined) {
    return { outcome: ok(structuredClone(replayed)), added: [] };
  }
  if (!movePositions(positions, write.positions)) {
    return { outcome: err("stale"), added: [] };
  }
  const { execution: draft, realizedUsdMicros } = write;
  const execution = { ...structuredClone(draft), id: executions.length + 1, realizedUsdMicros };
  return { outcome: ok(structuredClone(execution)), added: [execution] };
}

/**
 * Creates an empty in-memory {@link PositionStore} for tests. It keeps every row until it is
 * dropped, and checks a whole write before it changes anything.
 */
export function createMemoryPositionStore(): PositionStore {
  const positions: Positions = new Map();
  const executions: ExecutionRecord[] = [];
  const arrivals: ArrivalRecord[] = [];
  const departures: DepartureRecord[] = [];
  const record = (write: ExecutionWrite): Result<ExecutionRecord, "stale"> => {
    const { outcome, added } = recordExecution({ positions, executions }, write);
    executions.push(...added);
    return outcome;
  };
  const recordArrival = (write: ArrivalWrite): Result<ArrivalRecord, "stale"> => {
    if (!movePositions(positions, write.positions)) {
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
    recordDepartures: async (write, call) =>
      memoryCall(call, () => {
        const { outcome, added } = departOnce({ positions, departures }, structuredClone(write));
        departures.push(...added);
        return structuredClone(outcome);
      }),
    resetPaper: async (reset, call) =>
      memoryCall(call, () => {
        const stored = resetPaper(positions, structuredClone(reset), arrivals.length + 1);
        arrivals.push(...(stored.ok ? stored.value : []));
        return structuredClone(stored);
      }),
  };
}
