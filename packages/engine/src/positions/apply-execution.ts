import type { AssetRef } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { acquire, type CostBasis, dispose, emptyCostBasis } from "./average-cost.js";
import type { ExecutionDraft } from "./execution-record.js";
import type { PositionRecord, PositionWrite } from "./position-record.js";

interface Touched {
  readonly asset: AssetRef;
  readonly basis: CostBasis;
  readonly held: PositionRecord | undefined;
}

// A fee or gas worth something was paid in some units; a value with none would leak from P&L.
const isPaid = (base: bigint, usdMicros: bigint): boolean => base > 0n || usdMicros === 0n;

function assertTrade(execution: ExecutionDraft): void {
  const { sold, bought, gas } = execution;
  if (
    sold.base === 0n ||
    sold.asset === bought.asset ||
    !isPaid(execution.feeBase, execution.feeUsdMicros) ||
    !isPaid(gas.base, execution.gasUsdMicros)
  ) {
    throw new BinferenceError({
      code: "positions.bad_execution",
      message:
        "An execution sells some of one asset for another, and a fee or gas has units when it has a value.",
      details: { intent: execution.intentId },
    });
  }
}

// A coin the wallet holds from outside its executions, such as a deposit, leaves no row behind.
function isEmpty({ basis, held }: Touched): boolean {
  return (
    held === undefined &&
    basis.quantityBase === 0n &&
    basis.costUsdMicros === 0n &&
    basis.realizedUsdMicros === 0n
  );
}

function writeOf(execution: ExecutionDraft, touched: Touched): PositionWrite {
  const { asset, basis, held } = touched;
  return {
    position: {
      walletId: execution.walletId,
      asset,
      isPaper: execution.isPaper,
      quantityBase: basis.quantityBase,
      costUsdMicros: basis.costUsdMicros,
      realizedUsdMicros: basis.realizedUsdMicros,
      changedAtMs: Math.max(held?.changedAtMs ?? 0, execution.atMs),
    },
    ...(held === undefined ? {} : { readVersion: held.version }),
  };
}

/**
 * The position changes one execution makes, at average cost (decision 0058), in the order the
 * execution touches the assets. `held` holds the wallet's stored positions; an asset without one
 * starts empty, and its write carries no `readVersion`.
 *
 * - The sold token gives up the sold units and the fee, for their value at the time.
 * - The native coin gives up the gas, for its value at the time.
 * - The bought token takes the units that arrived, at the full cost: value, fee and gas.
 *
 * Each dollar counts once: what leaves one position is the cost of the next. Throws
 * `positions.bad_execution` for a trade that sells nothing, buys what it sells, or values a fee
 * or gas it paid no units of.
 */
export function applyExecution(
  held: readonly PositionRecord[],
  execution: ExecutionDraft,
): readonly PositionWrite[] {
  assertTrade(execution);
  const { walletId, isPaper, sold, bought, gas } = execution;
  const touched = new Map<AssetRef, Touched>();
  const change = (asset: AssetRef, step: (basis: CostBasis) => CostBasis): void => {
    const record = held.find(
      (position) =>
        position.walletId === walletId && position.asset === asset && position.isPaper === isPaper,
    );
    const entry = touched.get(asset) ?? { asset, basis: record ?? emptyCostBasis, held: record };
    touched.set(asset, { ...entry, basis: step(entry.basis) });
  };
  change(sold.asset, (basis) =>
    dispose(
      basis,
      sold.base + execution.feeBase,
      execution.valueUsdMicros + execution.feeUsdMicros,
    ),
  );
  if (gas.base > 0n) {
    change(gas.asset, (basis) => dispose(basis, gas.base, execution.gasUsdMicros));
  }
  const costUsdMicros = execution.valueUsdMicros + execution.feeUsdMicros + execution.gasUsdMicros;
  change(bought.asset, (basis) => acquire(basis, bought.base, costUsdMicros));
  return [...touched.values()]
    .filter((entry) => !isEmpty(entry))
    .map((entry) => writeOf(execution, entry));
}
