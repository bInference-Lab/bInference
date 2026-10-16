import type { AssetRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { AssetInfos, PnlCardView } from "@binference/protocol";
import { type AssetSources, knownAssetInfos } from "../money-path/asset-infos.js";
import type { PositionStore } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import { drawPnlCard } from "./draw-pnl-card.js";
import { addFigures, type PositionFigures, positionFigures } from "./position-figures.js";
import { readAllRows } from "./read-all-rows.js";

/** What the P&L cards read: the position rows valued now, the ledger, and the assets' info. */
export interface PnlCardParts extends AssetSources {
  readonly store: PositionStore;
  readonly positions: Positions;
}

/** Whose cards to draw: an agent's wallets, and the range a closed position must have closed in. */
export interface PnlCardsQuery {
  readonly wallets: readonly Id<"wal">[];
  readonly agentName: string;
  readonly fromMs: number;
  readonly toMs: number;
}

/** The cards in the order a surface shows them, and the info of every asset they name. */
export interface PnlCards {
  readonly cards: readonly PnlCardView[];
  readonly assets: AssetInfos;
}

interface Read {
  readonly signal: AbortSignal;
}

// One wallet's positions in one mode with their figures over each one's span. A paper span starts
// at the last paper reset: its starting balances are the wallet's only paper arrivals.
async function walletFigures(
  parts: PnlCardParts,
  wallet: { readonly walletId: Id<"wal">; readonly isPaper: boolean },
  call: Read,
): Promise<readonly PositionFigures[]> {
  const [valued, executions, arrivals] = await Promise.all([
    parts.positions.value(wallet, call),
    readAllRows(async (after, limit) => parts.store.executions({ ...wallet, after, limit }, call)),
    readAllRows(async (after, limit) => parts.store.arrivals({ ...wallet, after, limit }, call)),
  ]);
  const lastReset = arrivals.reduce((latest, { atMs }) => Math.max(latest, atMs), 0);
  const sinceMs = wallet.isPaper ? lastReset : 0;
  return valued.map((each) => positionFigures(each, { executions, arrivals, sinceMs }));
}

// The agent's positions in one mode: each asset's figures added up over its wallets.
function byAsset(figures: readonly PositionFigures[]): readonly PositionFigures[] {
  const added = new Map<AssetRef, PositionFigures>();
  for (const each of figures) {
    const before = added.get(each.asset);
    added.set(each.asset, before === undefined ? each : addFigures(before, each));
  }
  return [...added.values()];
}

// The highest value first; a position with no price comes last, then by asset.
function byValue(left: PositionFigures, right: PositionFigures): number {
  const [a, b] = [left.valueUsdMicros ?? -1n, right.valueUsdMicros ?? -1n];
  if (a !== b) {
    return b > a ? 1 : -1;
  }
  return left.asset < right.asset ? -1 : 1;
}

// One mode's cards: the open positions by value, then those closed in the range, latest first.
function shown(
  figures: readonly PositionFigures[],
  query: PnlCardsQuery,
): readonly PositionFigures[] {
  const open = figures.filter(({ quantityBase }) => quantityBase > 0n).toSorted(byValue);
  const closed = figures
    .filter(
      ({ quantityBase, sales, changedAtMs }) =>
        quantityBase === 0n &&
        sales > 0 &&
        changedAtMs >= query.fromMs &&
        changedAtMs <= query.toMs,
    )
    .toSorted((left, right) => right.changedAtMs - left.changedAtMs);
  return [...open, ...closed];
}

async function modeFigures(
  parts: PnlCardParts,
  query: PnlCardsQuery & { readonly isPaper: boolean },
  call: Read,
): Promise<readonly PositionFigures[]> {
  const wallets = await Promise.all(
    query.wallets.map(async (walletId) =>
      walletFigures(parts, { walletId, isPaper: query.isPaper }, call),
    ),
  );
  return shown(byAsset(wallets.flat()), query);
}

/**
 * An agent's P&L cards (decision 0243): one per position of its wallets open now, and per position
 * that emptied by a sale from `fromMs` to `toMs`, both included; live before paper, never added
 * together. Each card's figures cover the position's whole span, whatever the range. A token the
 * registry and the intents do not know is named by its short address.
 */
export async function pnlCardsOf(
  parts: PnlCardParts,
  query: PnlCardsQuery,
  call: Read,
): Promise<PnlCards> {
  const [live, paper] = await Promise.all([
    modeFigures(parts, { ...query, isPaper: false }, call),
    modeFigures(parts, { ...query, isPaper: true }, call),
  ]);
  const figures = [...live, ...paper];
  const assets = await knownAssetInfos(
    parts,
    [...new Set(figures.map(({ asset }) => asset))],
    call,
  );
  const cards = figures.map((each): PnlCardView => {
    const info = assets[each.asset];
    const facts = { figures: each, agentName: query.agentName };
    return {
      asset: each.asset,
      paper: each.isPaper,
      closed: each.quantityBase === 0n,
      lines: drawPnlCard(info === undefined ? facts : { ...facts, info }),
    };
  });
  return { cards, assets };
}
