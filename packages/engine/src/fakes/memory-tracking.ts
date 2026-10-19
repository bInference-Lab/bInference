import type { AccountRef } from "@binference/chain";
import { maxTrackedWallets } from "../alerts/alert-record.js";

/** A source of tracked wallets: the accounts its live rows name now. */
type TrackingSource = (call: { readonly signal: AbortSignal }) => Promise<ReadonlySet<AccountRef>>;

/** A `tracked_wallets` row in memory. */
interface TrackedRow {
  readonly account: AccountRef;
  readonly sinceBlock?: bigint;
  readonly lastBlock?: bigint;
  readonly overflowBlocks: number;
  readonly addedAtMs: number;
  readonly untrackedAtMs?: number;
}

/**
 * The tracked wallets in memory, as the alert and order fakes keep them (decision 0251): each
 * write that can change what names an account reconciles the rows with every source.
 */
export interface MemoryTracking {
  readonly rows: Map<AccountRef, TrackedRow>;
  /** Adds a source of tracked wallets: an alert or order fake. */
  addSource(source: TrackingSource): void;
  /** The accounts every source names now. */
  named(call: { readonly signal: AbortSignal }): Promise<ReadonlySet<AccountRef>>;
  /**
   * Moves the rows to the accounts the sources name now: a newly named account is tracked from
   * `atMs` with a new span, one no longer named is untracked at `atMs`. Answers the names.
   */
  reconcile(atMs: number, call: { readonly signal: AbortSignal }): Promise<ReadonlySet<AccountRef>>;
  /** Whether a write naming `account` stays within the 50 tracked wallets, after a reconcile. */
  hasRoom(account: AccountRef): boolean;
}

function track(rows: Map<AccountRef, TrackedRow>, account: AccountRef, atMs: number): void {
  const row = rows.get(account);
  if (row === undefined || row.untrackedAtMs !== undefined) {
    rows.set(account, { account, overflowBlocks: row?.overflowBlocks ?? 0, addedAtMs: atMs });
  }
}

/** Creates an empty {@link MemoryTracking}. */
export function createMemoryTracking(): MemoryTracking {
  const rows = new Map<AccountRef, TrackedRow>();
  const sources: TrackingSource[] = [];
  const namedNow = async (call: { readonly signal: AbortSignal }) => {
    const named = new Set<AccountRef>();
    for (const names of await Promise.all(sources.map(async (source) => source(call)))) {
      names.forEach((account) => named.add(account));
    }
    return named;
  };
  return {
    rows,
    addSource: (source) => {
      sources.push(source);
    },
    named: namedNow,
    async reconcile(atMs, call) {
      const named = await namedNow(call);
      named.forEach((account) => track(rows, account, atMs));
      for (const [account, row] of rows) {
        if (!named.has(account) && row.untrackedAtMs === undefined) {
          rows.set(account, { ...row, untrackedAtMs: atMs });
        }
      }
      return named;
    },
    hasRoom(account) {
      const active = [...rows.values()].filter(({ untrackedAtMs }) => untrackedAtMs === undefined);
      return active.some((row) => row.account === account) || active.length < maxTrackedWallets;
    },
  };
}
