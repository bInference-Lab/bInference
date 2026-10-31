import {
  type AccountRef,
  type Amount,
  type ChainFamily,
  isSameAccount,
  type SimulatedStep,
} from "@binference/chain";

/** One send of an asset, as it is, from a wallet's account to a recipient. */
export interface PlannedTransfer {
  readonly from: AccountRef;
  readonly to: AccountRef;
  readonly amount: Amount;
}

function sumOf(amounts: readonly Amount[]): bigint {
  return amounts.reduce((sum, { base }) => sum + base, 0n);
}

/**
 * What of a send's asset reached its recipient when its step ran unsent (spec 6, section 3), or
 * `undefined` when the step did not run as planned: it failed, set an allowance, moved anything
 * but exactly its amount of its asset out of the sending account, or landed none of it at the
 * recipient. A token that takes a tax on transfers still passes with what arrived.
 */
export function checkTransfer(
  step: SimulatedStep | undefined,
  planned: PlannedTransfer,
  family: ChainFamily,
): Amount | undefined {
  const { asset } = planned.amount;
  if (step?.status !== "success" || step.approvals.length > 0) {
    return undefined;
  }
  const out = step.transfers.filter(({ from }) => isSameAccount(from, planned.from, family));
  const arrived = step.transfers.filter(
    ({ to, amount }) => isSameAccount(to, planned.to, family) && amount.asset === asset,
  );
  const received = { asset, base: sumOf(arrived.map(({ amount }) => amount)) };
  const isWhole =
    out.every(({ amount }) => amount.asset === asset) &&
    sumOf(out.map(({ amount }) => amount)) === planned.amount.base;
  return isWhole && received.base > 0n ? received : undefined;
}
