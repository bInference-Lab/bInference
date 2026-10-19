import type { ChainRef } from "@binference/chain";
import {
  creatorWindowMs,
  type LaunchCurveChange,
  type LaunchPlace,
  type LaunchQuery,
  type LaunchReadRecord,
  launchKeepMs,
  type NewLaunch,
  type StoredLaunch,
} from "../launches/launch-record.js";
import type { LaunchStore } from "../launches/ports.js";
import type { WatchCursorRecord } from "../leaders/tracked-wallet-record.js";

type Row = Omit<StoredLaunch, "creatorLaunches30d">;

interface State {
  readonly rows: Map<string, Row>;
  readonly cursors: Map<ChainRef, WatchCursorRecord>;
}

const fullCurveBps = 10_000;

const keyOf = (chain: ChainRef, launch: Pick<NewLaunch, "token">): string =>
  `${chain}|${launch.token}`;

// Whether launch `a` came before launch `b`: by time, then block, then log index.
function isBefore(a: LaunchPlace, b: LaunchPlace): boolean {
  if (a.launchedAtMs !== b.launchedAtMs) {
    return a.launchedAtMs < b.launchedAtMs;
  }
  return a.block === b.block ? a.logIndex < b.logIndex : a.block < b.block;
}

// A bound given holds only on a value known.
const atMost = (bound: number | undefined, value: number | undefined): boolean =>
  bound === undefined || (value !== undefined && value <= bound);

// Its curve went at least as far as the filter asks; a graduated launch's counts as full.
function curvePasses(query: LaunchQuery, launch: StoredLaunch): boolean {
  const least = query.filters?.minCurveProgressBps;
  const progress = launch.graduated ? fullCurveBps : launch.curveProgressBps;
  return least === undefined || (progress !== undefined && progress >= least);
}

// Where the page is: launched at or after `fromMs`, and before `before`.
function pagePasses(query: LaunchQuery, launch: StoredLaunch): boolean {
  const { fromMs, before } = query;
  return (
    (fromMs === undefined || launch.launchedAtMs >= fromMs) &&
    (before === undefined || isBefore(launch, before))
  );
}

// The filters on what the launch is: its launchpad, quote token and curve.
function placePasses(query: LaunchQuery, launch: StoredLaunch): boolean {
  const filters = query.filters ?? {};
  return (
    (filters.launchpads?.includes(launch.launchpad) ?? true) &&
    (filters.quoteTokens?.includes(launch.quoteToken) ?? true) &&
    pagePasses(query, launch) &&
    curvePasses(query, launch)
  );
}

// The filters on its taxes, its insiders and its creator's other launches.
function boundsPass(query: LaunchQuery, launch: StoredLaunch): boolean {
  const filters = query.filters ?? {};
  return (
    atMost(filters.maxTaxBps, launch.taxBps) &&
    atMost(filters.maxSnipeTaxBps, launch.snipeTaxBps) &&
    atMost(filters.maxInsiders, launch.insiders.length) &&
    atMost(filters.maxCreatorLaunches30d, launch.creatorLaunches30d)
  );
}

function withCount(state: State, row: Row): StoredLaunch {
  const prior = [...state.rows.values()].filter(
    (other) =>
      other.creator === row.creator &&
      other.launchedAtMs >= row.launchedAtMs - creatorWindowMs &&
      isBefore(other, row),
  );
  return { ...row, creatorLaunches30d: prior.length };
}

// Deletes the read's span's launches it no longer holds, and the chain's ones past 90 days.
function forget(state: State, read: LaunchReadRecord): void {
  const held = new Set(read.launches.map((launch) => keyOf(read.chain, launch)));
  for (const [key, row] of state.rows) {
    const isOurs = row.chain === read.chain;
    const inSpan = row.block >= read.from && row.block <= read.to && !held.has(key);
    if (isOurs && (inSpan || row.launchedAtMs < read.atMs - launchKeepMs)) {
      state.rows.delete(key);
    }
  }
}

function change(state: State, read: LaunchReadRecord, curve: LaunchCurveChange): void {
  const key = keyOf(read.chain, curve);
  const row = state.rows.get(key);
  if (row !== undefined) {
    const { curveProgressBps: progress, graduated } = curve;
    state.rows.set(key, {
      ...row,
      ...(progress === undefined ? {} : { curveProgressBps: progress }),
      ...(graduated === true ? { graduated } : {}),
      changedAtMs: read.atMs,
    });
  }
}

// Stores a launch new, or moves a stored one to where the read found it.
function store(state: State, read: LaunchReadRecord, launch: NewLaunch): readonly Row[] {
  const key = keyOf(read.chain, launch);
  const row = state.rows.get(key);
  if (row !== undefined) {
    const { block, blockHash, txHash, logIndex, launchedAtMs } = launch;
    state.rows.set(key, { ...row, block, blockHash, txHash, logIndex, launchedAtMs });
    return [];
  }
  const added = { ...launch, chain: read.chain, changedAtMs: read.atMs };
  state.rows.set(key, added);
  return [added];
}

/**
 * A {@link LaunchStore} in memory, for tests: launches by chain and token, and one cursor per
 * chain. Each call settles on the next turn of the event loop, as a database call would.
 */
export function createMemoryLaunchStore(): LaunchStore {
  const state: State = { rows: new Map(), cursors: new Map() };
  return {
    async cursor(chain, { signal }) {
      await Promise.resolve();
      signal.throwIfAborted();
      return state.cursors.get(chain);
    },
    async record(read, { signal }) {
      await Promise.resolve();
      signal.throwIfAborted();
      forget(state, read);
      const added = read.launches.flatMap((launch) => store(state, read, launch));
      for (const curve of read.changes) {
        change(state, read, curve);
      }
      const { chain, to, toHash, atMs } = read;
      state.cursors.set(chain, { chain, block: to, blockHash: toHash, atMs });
      return added.map((row) => withCount(state, row));
    },
    async list(query, { signal }) {
      await Promise.resolve();
      signal.throwIfAborted();
      return [...state.rows.values()]
        .filter(({ chain }) => chain === query.chain)
        .map((row) => withCount(state, row))
        .filter((launch) => placePasses(query, launch) && boundsPass(query, launch))
        .toSorted((a, b) => (isBefore(a, b) ? 1 : -1))
        .slice(0, query.limit);
    },
  };
}
