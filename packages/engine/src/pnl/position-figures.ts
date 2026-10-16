import type { AssetRef } from "@binference/chain";
import type { ArrivalRecord } from "../positions/arrival-record.js";
import type { ValuedPosition } from "../positions/create-positions.js";
import type { ExecutionRecord } from "../positions/execution-record.js";

/**
 * What a P&L card shows of one position (decision 0243): what it holds and costs now, what its
 * trades paid and brought in over its span, in micro-dollars at their time, and when it opened
 * and last changed. Below zero is a loss.
 */
export interface PositionFigures {
  readonly asset: AssetRef;
  readonly isPaper: boolean;
  readonly quantityBase: bigint;
  readonly costUsdMicros: bigint;
  /** What the units held are worth now, rounded down; absent when one of them has no price. */
  readonly valueUsdMicros?: bigint;
  /** The realized P&L net of every fee: the rows' realized P&L minus the sales' fees and gas. */
  readonly realizedUsdMicros: bigint;
  /** What the buys cost with their fees and gas, and the value of the funds that arrived. */
  readonly boughtUsdMicros: bigint;
  /** What the sales brought in: each sale's value minus its gas; its fee was paid on top. */
  readonly soldUsdMicros: bigint;
  readonly venueFeeUsdMicros: bigint;
  readonly networkFeeUsdMicros: bigint;
  /** How many executions in the span sold the asset. */
  readonly sales: number;
  /** The first trade or arrival of the span; absent when the ledger holds none. */
  readonly openedAtMs?: number;
  /** When a row of the position last changed: when it emptied, for a closed one. */
  readonly changedAtMs: number;
}

/** One wallet's ledger in one mode, and where a position's span starts. */
export interface WalletLedger {
  readonly executions: readonly ExecutionRecord[];
  readonly arrivals: readonly ArrivalRecord[];
  /** The span starts here: the last paper reset for paper, 0 for live. */
  readonly sinceMs: number;
}

const earliest = (left: number | undefined, right: number | undefined): number | undefined =>
  left === undefined || (right !== undefined && right < left) ? right : left;

const sum = (rows: readonly ExecutionRecord[], part: (row: ExecutionRecord) => bigint): bigint =>
  rows.reduce((total, row) => total + part(row), 0n);

// A trade's fee and gas count on the card of every position it bought or sold.
function tradeFigures(asset: AssetRef, executions: readonly ExecutionRecord[]) {
  const trades = executions.filter(
    ({ sold, bought }) => sold.asset === asset || bought.asset === asset,
  );
  const buys = trades.filter(({ bought }) => bought.asset === asset);
  const sales = trades.filter(({ sold }) => sold.asset === asset);
  return {
    bought: sum(buys, (row) => row.valueUsdMicros + row.feeUsdMicros + row.gasUsdMicros),
    sold: sum(sales, (row) => row.valueUsdMicros - row.gasUsdMicros),
    salesFees: sum(sales, (row) => row.feeUsdMicros + row.gasUsdMicros),
    venueFee: sum(trades, (row) => row.feeUsdMicros),
    networkFee: sum(trades, (row) => row.gasUsdMicros),
    sales: sales.length,
    openedAtMs: trades.map(({ atMs }) => atMs).reduce<number | undefined>(earliest, undefined),
  };
}

/**
 * The figures of one wallet's position as its row and its ledger hold them, over the position's
 * span: from `ledger.sinceMs` on. Reads nothing; the ledger is the wallet's, in the row's mode.
 */
export function positionFigures(valued: ValuedPosition, ledger: WalletLedger): PositionFigures {
  const { position } = valued;
  const inSpan = <T extends { readonly atMs: number }>(rows: readonly T[]): readonly T[] =>
    rows.filter(({ atMs }) => atMs >= ledger.sinceMs);
  const trades = tradeFigures(position.asset, inSpan(ledger.executions));
  const arrived = inSpan(ledger.arrivals).filter(
    ({ received, valueUsdMicros }) =>
      received.asset === position.asset && valueUsdMicros !== undefined,
  );
  const arrivedUsdMicros = arrived.reduce((total, row) => total + (row.valueUsdMicros ?? 0n), 0n);
  const firstArrival = arrived
    .map(({ atMs }) => atMs)
    .reduce<number | undefined>(earliest, undefined);
  const openedAtMs = earliest(trades.openedAtMs, firstArrival);
  return {
    asset: position.asset,
    isPaper: position.isPaper,
    quantityBase: position.quantityBase,
    costUsdMicros: position.costUsdMicros,
    ...(valued.valueUsdMicros === undefined ? {} : { valueUsdMicros: valued.valueUsdMicros }),
    realizedUsdMicros: position.realizedUsdMicros - trades.salesFees,
    boughtUsdMicros: trades.bought + arrivedUsdMicros,
    soldUsdMicros: trades.sold,
    venueFeeUsdMicros: trades.venueFee,
    networkFeeUsdMicros: trades.networkFee,
    sales: trades.sales,
    ...(openedAtMs === undefined ? {} : { openedAtMs }),
    changedAtMs: position.changedAtMs,
  };
}

const addValue = (left: bigint | undefined, right: bigint | undefined): bigint | undefined =>
  left === undefined || right === undefined ? undefined : left + right;

/**
 * One position of an agent from its wallets' positions of the same asset in the same mode: their
 * figures added up, opened at the earliest, changed at the latest. Without a price for one of
 * them, the sum has no value.
 */
export function addFigures(left: PositionFigures, right: PositionFigures): PositionFigures {
  const valueUsdMicros = addValue(left.valueUsdMicros, right.valueUsdMicros);
  const openedAtMs = earliest(left.openedAtMs, right.openedAtMs);
  return {
    asset: left.asset,
    isPaper: left.isPaper,
    quantityBase: left.quantityBase + right.quantityBase,
    costUsdMicros: left.costUsdMicros + right.costUsdMicros,
    ...(valueUsdMicros === undefined ? {} : { valueUsdMicros }),
    realizedUsdMicros: left.realizedUsdMicros + right.realizedUsdMicros,
    boughtUsdMicros: left.boughtUsdMicros + right.boughtUsdMicros,
    soldUsdMicros: left.soldUsdMicros + right.soldUsdMicros,
    venueFeeUsdMicros: left.venueFeeUsdMicros + right.venueFeeUsdMicros,
    networkFeeUsdMicros: left.networkFeeUsdMicros + right.networkFeeUsdMicros,
    sales: left.sales + right.sales,
    ...(openedAtMs === undefined ? {} : { openedAtMs }),
    changedAtMs: Math.max(left.changedAtMs, right.changedAtMs),
  };
}
