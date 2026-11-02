import { type Id, err, ok, type Result } from "@binference/core";
import type { UnbondingStore } from "../staking/ports.js";
import type {
  UnbondingClaim,
  UnbondingDraft,
  UnbondingQuery,
  UnbondingReadyQuery,
  UnbondingRecord,
  UnbondingTold,
} from "../staking/unbonding-record.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/** What the in-memory unbonding store checks an unbonding's intents against. */
export interface MemoryUnbondingStoreOptions {
  readonly hasIntent: (id: Id<"int">) => boolean;
}

type Rows = Map<number, UnbondingRecord>;

// The soonest ready first, then the oldest, as the SQLite store lists them.
function byReady(left: UnbondingRecord, right: UnbondingRecord): number {
  return left.readyAtMs === right.readyAtMs ? left.id - right.id : left.readyAtMs - right.readyAtMs;
}

function isOf(row: UnbondingRecord, query: UnbondingQuery): boolean {
  return (
    row.walletId === query.walletId &&
    row.isPaper === query.isPaper &&
    row.venue === query.venue &&
    row.validator === query.validator
  );
}

const copies = (rows: Iterable<UnbondingRecord>, keep: (row: UnbondingRecord) => boolean) =>
  [...rows]
    .filter(keep)
    .toSorted(byReady)
    .map((row) => structuredClone(row));

// An unstake opens once; a request of the venue's wallet in its mode is held once, as the SQLite
// store's unique index holds it.
function open(rows: Rows, draft: UnbondingDraft, options: MemoryUnbondingStoreOptions) {
  const all = [...rows.values()];
  const held = all.find((row) => row.intentId === draft.intentId);
  if (held !== undefined) {
    return structuredClone(held);
  }
  const isTaken = all.some(
    (row) =>
      row.venue === draft.venue &&
      row.walletId === draft.walletId &&
      row.isPaper === draft.isPaper &&
      row.requestRef === draft.requestRef,
  );
  if (!options.hasIntent(draft.intentId) || isTaken) {
    throw constraintFault("an unbonding of an unknown intent or of a request held");
  }
  const opened: UnbondingRecord = { ...structuredClone(draft), id: rows.size + 1 };
  rows.set(opened.id, opened);
  return structuredClone(opened);
}

function claim(
  rows: Rows,
  taken: UnbondingClaim,
  options: MemoryUnbondingStoreOptions,
): Result<readonly UnbondingRecord[], "taken"> {
  const { claimIntentId, atMs } = taken;
  if (!options.hasIntent(claimIntentId)) {
    throw constraintFault("a claim of an intent the store does not hold");
  }
  const named = [...rows.values()].filter(
    (row) => isOf(row, taken) && taken.requestRefs.includes(row.requestRef),
  );
  if (named.some((row) => row.claimIntentId !== undefined && row.claimIntentId !== claimIntentId)) {
    return err("taken");
  }
  for (const row of named) {
    rows.set(row.id, { ...row, claimIntentId, claimedAtMs: row.claimedAtMs ?? atMs });
  }
  return ok(copies(rows.values(), (row) => row.claimIntentId === claimIntentId));
}

function untoldReady(rows: Rows, query: UnbondingReadyQuery): readonly UnbondingRecord[] {
  const ready = (row: UnbondingRecord) =>
    row.claimIntentId === undefined &&
    row.toldReadyAtMs === undefined &&
    row.readyAtMs <= query.nowMs;
  return copies(rows.values(), ready).slice(0, query.limit);
}

function markTold(rows: Rows, told: UnbondingTold): void {
  for (const id of told.ids) {
    const row = rows.get(id);
    if (row !== undefined && row.toldReadyAtMs === undefined) {
      rows.set(id, { ...row, toldReadyAtMs: told.atMs });
    }
  }
}

/** Creates an in-memory {@link UnbondingStore} with no unbonding, for tests. */
export function createMemoryUnbondingStore(options: MemoryUnbondingStoreOptions): UnbondingStore {
  const rows: Rows = new Map();
  return {
    open: async (draft, call) => memoryCall(call, () => open(rows, draft, options)),
    listOpen: async (query, call) =>
      memoryCall(call, () =>
        copies(rows.values(), (row) => isOf(row, query) && row.claimIntentId === undefined),
      ),
    claimedBy: async (claimIntentId, call) =>
      memoryCall(call, () => copies(rows.values(), (row) => row.claimIntentId === claimIntentId)),
    claim: async (taken, call) => memoryCall(call, () => claim(rows, taken, options)),
    untoldReady: async (query, call) => memoryCall(call, () => untoldReady(rows, query)),
    markTold: async (told, call) => memoryCall(call, () => markTold(rows, told)),
  };
}
