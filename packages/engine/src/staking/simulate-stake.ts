import {
  type AccountRef,
  type Amount,
  type AssetApproval,
  type AssetRef,
  type AssetTransfer,
  type ChainFamily,
  isSameAccount,
  type SimulatedStep,
  type TxDraft,
  type TxSimulator,
} from "@binference/chain";
import type { StakePlan } from "@binference/chain/staking";
import { err, ok, type Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { SimulationFailure } from "../intents/intent-reason.js";

/** What a staking move's simulation is judged by: the wallet's family and the venue's spenders. */
interface SimulationBounds {
  readonly family: ChainFamily;
  /** The spenders the venue declares on the chain, which an unstake's approval may name. */
  readonly spenders: readonly AccountRef[];
}

// An allowance a step set: none, but an unstake's of its own receipt units to a spender the venue
// declares, set to exactly the units it burns or back to zero once its call spent them (decision
// 0331).
function isPlannedApproval(
  approval: AssetApproval,
  plan: StakePlan,
  bounds: SimulationBounds,
): boolean {
  const { shares } = plan;
  const { family, spenders } = bounds;
  return (
    plan.action === "unstake" &&
    shares !== undefined &&
    isSameAccount(approval.owner, plan.wallet, family) &&
    spenders.some((spender) => isSameAccount(spender, approval.spender, family)) &&
    approval.amount.asset === shares.asset &&
    (approval.amount.base === shares.base || approval.amount.base === 0n)
  );
}

// The base units of the asset the transfers move.
function sumOf(transfers: readonly AssetTransfer[], asset: AssetRef | undefined): bigint {
  return transfers
    .filter(({ amount }) => amount.asset === asset)
    .reduce((sum, { amount }) => sum + amount.base, 0n);
}

// The receipt units moved as planned: out of the wallet no more than an unstake burns, and into it,
// for a stake that promises its least units, at least those (decision 0331).
function unitsAsPlanned(
  out: readonly AssetTransfer[],
  into: readonly AssetTransfer[],
  plan: StakePlan,
): boolean {
  const { shares, minShares } = plan;
  const burned = plan.action === "unstake" ? (shares?.base ?? 0n) : 0n;
  return (
    (shares === undefined || sumOf(out, shares.asset) <= burned) &&
    (minShares === undefined || sumOf(into, minShares.asset) >= minShares.base)
  );
}

// Each step ran, set no allowance but an unstake's own, moved out of the wallet no more of the
// chain's coin than the plan sends, took out of it nothing but that coin, the receipt units and
// the voting token the venue mints with them, which an unstake burns, and moved receipt units as
// planned.
function ranAsPlanned(
  steps: readonly SimulatedStep[],
  plan: StakePlan,
  bounds: SimulationBounds,
): boolean {
  const { family } = bounds;
  const transfers = steps.flatMap((step) => step.transfers);
  const out = transfers.filter(({ from }) => isSameAccount(from, plan.wallet, family));
  const into = transfers.filter(({ to }) => isSameAccount(to, plan.wallet, family));
  const allowed = new Set([plan.value.asset, plan.shares?.asset, plan.votingToken]);
  return (
    steps.every((step) => step.approvals.every((item) => isPlannedApproval(item, plan, bounds))) &&
    out.every(({ amount }) => allowed.has(amount.asset)) &&
    sumOf(out, plan.value.asset) <= plan.value.base &&
    unitsAsPlanned(out, into, plan)
  );
}

// What the view says left and reached the wallet: a stake's coin for its receipt units, an
// unstake's receipt units, a claim's coin back.
function viewOf(plan: StakePlan, simulatedAt: number): SimulationView {
  const { shares, value, moved } = plan;
  const units: readonly Amount[] = shares === undefined ? [] : [shares];
  if (plan.action === "stake") {
    return { spent: [value], received: units, simulatedAt };
  }
  return plan.action === "unstake"
    ? { spent: units, received: [], simulatedAt }
    : { spent: [], received: [moved], simulatedAt };
}

/**
 * The simulate step of a live staking move (decision 0327): its call runs unsent on the chain's
 * latest state. It passes when it runs, sets no allowance but a liquid unstake's own to a spender
 * its venue declares (decision 0331), mints a stake at least the receipt units its card promises,
 * and moves out of the wallet no more receipt units than it burns and no more of the chain's coin
 * than its plan sends: a stake's amount, nothing for an unstake or a claim. A
 * step that reverts is `simulation_reverted`, any other difference `effects_differ`.
 */
export async function simulateStake(
  parts: SimulationBounds & {
    readonly simulator: TxSimulator;
    readonly nowMs: () => number;
  },
  planned: { readonly plan: StakePlan; readonly steps: readonly TxDraft[] },
  signal: AbortSignal,
): Promise<Result<SimulationView, SimulationFailure>> {
  const { plan, steps } = planned;
  const simulated = await parts.simulator.simulate(steps, { signal });
  if (simulated.length !== steps.length || simulated.some((step) => step.status !== "success")) {
    return err("simulation_reverted");
  }
  return ranAsPlanned(simulated, plan, parts)
    ? ok(viewOf(plan, parts.nowMs()))
    : err("effects_differ");
}

/** The view of a paper staking move, which runs nothing: what its paper plan moves. */
export function paperStakeView(plan: StakePlan, simulatedAt: number): SimulationView {
  return viewOf(plan, simulatedAt);
}
