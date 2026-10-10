import type { Id } from "@binference/core";
import type { PastOutflow } from "../policy/policy-rules.js";
import type { PositionStore } from "../ports.js";
import type { ExecutionRecord } from "../positions/execution-record.js";

/** Whose outflows to read: an agent's wallets, in one mode, up to now. */
export interface RecentOutflowsQuery {
  readonly wallets: readonly Id<"wal">[];
  readonly isPaper: boolean;
  readonly nowMs: number;
}

// The policy keeps 24 hours; an outflow exactly that old still counts, so the read keeps it too.
const windowMs = 86_400_000;
const pageLimit = 1_000;

async function executionsOf(
  positions: PositionStore,
  query: { readonly walletId: Id<"wal">; readonly isPaper: boolean; readonly fromMs: number },
  page: { readonly after: number; readonly signal: AbortSignal },
): Promise<readonly ExecutionRecord[]> {
  const { signal, after } = page;
  const rows = await positions.executions({ ...query, after, limit: pageLimit }, { signal });
  const last = rows.at(-1);
  return rows.length < pageLimit || last === undefined
    ? rows
    : [...rows, ...(await executionsOf(positions, query, { signal, after: last.id }))];
}

/**
 * The outflows the policy's rolling cap counts for an agent (ARCHITECTURE.md section 23): every
 * trade its wallets settled or filled on paper in the query's mode over the last 24 hours, each
 * at what left the wallet then, its sold value and its venue fee in USD as the execution recorded
 * them. A trade counts once it is recorded; one confirmed and not yet settled is not in the list.
 */
export async function recentOutflowsOf(
  positions: PositionStore,
  query: RecentOutflowsQuery,
  options: { readonly signal: AbortSignal },
): Promise<readonly PastOutflow[]> {
  const fromMs = query.nowMs - windowMs;
  const read = await Promise.all(
    query.wallets.map(async (walletId) =>
      executionsOf(
        positions,
        { walletId, isPaper: query.isPaper, fromMs },
        { after: 0, signal: options.signal },
      ),
    ),
  );
  return read.flat().map((execution) => ({
    atMs: execution.atMs,
    valueUsdMicros: execution.valueUsdMicros + execution.feeUsdMicros,
  }));
}
