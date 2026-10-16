import type { AssetRef, ChainRegistry } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import { assetInfosOf } from "../money-path/asset-infos.js";
import { readAllRows } from "../pnl/read-all-rows.js";
import type { PositionStore } from "../ports.js";
import type { Positions, ValuedPosition } from "../positions/create-positions.js";
import type { ExecutionRecord } from "../positions/execution-record.js";

type PnlView = ResultOf<"portfolio/pnl">;
type PositionPnl = PnlView["positions"][number];

/** Whose P&L to read: an agent's wallets, over a range of time with both ends included. */
export interface PnlQuery {
  readonly wallets: readonly Id<"wal">[];
  readonly fromMs: number;
  readonly toMs: number;
}

/** What the P&L reads: the executions as recorded, and the positions valued now. */
export interface PnlParts {
  readonly store: PositionStore;
  readonly positions: Positions;
  readonly chains: ChainRegistry;
}

interface Read {
  readonly signal: AbortSignal;
}

/** One mode's P&L, its positions in the order of their assets. */
interface ModePnl {
  readonly positions: readonly PositionPnl[];
  readonly realizedUsdMicros: bigint;
  readonly unrealizedUsdMicros?: bigint;
}

// Every execution of one wallet in one mode in the range.
async function executionsOf(
  store: PositionStore,
  query: { readonly walletId: Id<"wal">; readonly isPaper: boolean } & Omit<PnlQuery, "wallets">,
  call: Read,
): Promise<readonly ExecutionRecord[]> {
  return readAllRows(async (after, limit) => store.executions({ ...query, after, limit }, call));
}

const add = (total: bigint | undefined, part: bigint | undefined): bigint | undefined =>
  total === undefined || part === undefined ? undefined : total + part;

// What each asset sold in the range realized: an execution's gain or loss counts for the asset it
// sold, its gas coin's share with it.
function realizedByAsset(executions: readonly ExecutionRecord[]): ReadonlyMap<AssetRef, bigint> {
  const realized = new Map<AssetRef, bigint>();
  for (const { sold, realizedUsdMicros } of executions) {
    realized.set(sold.asset, (realized.get(sold.asset) ?? 0n) + realizedUsdMicros);
  }
  return realized;
}

// The unrealized P&L of what each asset's positions hold now; absent for an asset a position of
// which has no price.
function unrealizedByAsset(
  held: readonly ValuedPosition[],
): ReadonlyMap<AssetRef, bigint | undefined> {
  const unrealized = new Map<AssetRef, bigint | undefined>();
  for (const { position, unrealizedUsdMicros } of held) {
    const before = unrealized.has(position.asset) ? unrealized.get(position.asset) : 0n;
    unrealized.set(position.asset, add(before, unrealizedUsdMicros));
  }
  return unrealized;
}

interface AssetFigures {
  readonly realized: ReadonlyMap<AssetRef, bigint>;
  readonly unrealized: ReadonlyMap<AssetRef, bigint | undefined>;
}

// One asset's line; an asset no position holds now has nothing unrealized.
function lineOf(asset: AssetRef, figures: AssetFigures): PositionPnl {
  const unrealizedUsdMicros = figures.unrealized.has(asset) ? figures.unrealized.get(asset) : 0n;
  const line = { asset, realizedUsdMicros: figures.realized.get(asset) ?? 0n };
  return unrealizedUsdMicros === undefined ? line : { ...line, unrealizedUsdMicros };
}

async function modePnlOf(
  parts: PnlParts,
  query: PnlQuery & { readonly isPaper: boolean },
  call: Read,
): Promise<ModePnl> {
  const { isPaper, fromMs, toMs } = query;
  const [executions, valued] = await Promise.all([
    Promise.all(
      query.wallets.map(async (walletId) =>
        executionsOf(parts.store, { walletId, isPaper, fromMs, toMs }, call),
      ),
    ),
    Promise.all(
      query.wallets.map(async (walletId) => parts.positions.value({ walletId, isPaper }, call)),
    ),
  ]);
  const realized = realizedByAsset(executions.flat());
  const held = valued.flat().filter(({ position }) => position.quantityBase > 0n);
  const unrealized = unrealizedByAsset(held);
  const assets = [...new Set([...realized.keys(), ...unrealized.keys()])].toSorted();
  const positions = assets.map((asset) => lineOf(asset, { realized, unrealized }));
  const realizedUsdMicros = positions.reduce((sum, item) => sum + item.realizedUsdMicros, 0n);
  const unrealizedUsdMicros = positions.reduce<bigint | undefined>(
    (sum, item) => add(sum, item.unrealizedUsdMicros),
    0n,
  );
  return {
    positions,
    realizedUsdMicros,
    ...(unrealizedUsdMicros === undefined ? {} : { unrealizedUsdMicros }),
  };
}

/**
 * An agent's P&L at average cost (decision 0137), live and paper apart and never added together:
 * live in `positions` and its totals, paper in `paperPositions` and its own.
 *
 * - Realized: what the executions recorded in the range realized, each counted for the asset it
 *   sold, the gas coin's share with it.
 * - Unrealized: what the positions hold now at today's price, whatever the range; absent for an
 *   asset with no price, and so for its mode's total.
 * - Each asset sold in the range or held now has a line, in the order of the asset references.
 */
export async function pnlViewOf(parts: PnlParts, query: PnlQuery, call: Read): Promise<PnlView> {
  const [live, paper] = await Promise.all([
    modePnlOf(parts, { ...query, isPaper: false }, call),
    modePnlOf(parts, { ...query, isPaper: true }, call),
  ]);
  const assets = [...live.positions, ...paper.positions].map(({ asset }) => asset);
  return {
    ...live,
    paperPositions: paper.positions,
    paperRealizedUsdMicros: paper.realizedUsdMicros,
    ...(paper.unrealizedUsdMicros === undefined
      ? {}
      : { paperUnrealizedUsdMicros: paper.unrealizedUsdMicros }),
    assets: assetInfosOf(parts.chains, [...new Set(assets)]),
  };
}
