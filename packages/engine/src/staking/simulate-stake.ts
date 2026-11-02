import {
  type Amount,
  type AssetApproval,
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

// An allowance a step set: none, but an unstake's of its own receipt units, set to exactly the
// units it burns or back to zero once its call spent them (decision 0331).
function isPlannedApproval(approval: AssetApproval, plan: StakePlan, family: ChainFamily): boolean {
  const { shares } = plan;
  return (
    plan.action === "unstake" &&
    shares !== undefined &&
    isSameAccount(approval.owner, plan.wallet, family) &&
    approval.amount.asset === shares.asset &&
    (approval.amount.base === shares.base || approval.amount.base === 0n)
  );
}

// Each step ran, set no allowance but an unstake's own, moved out of the wallet no more of the
// chain's coin than the plan sends, and took out of it nothing but that coin, the plan's receipt
// units and the voting token the venue mints with them, which an unstake burns.
function ranAsPlanned(
  steps: readonly SimulatedStep[],
  plan: StakePlan,
  family: ChainFamily,
): boolean {
  const out = steps
    .flatMap(({ transfers }) => transfers)
    .filter(({ from }) => isSameAccount(from, plan.wallet, family));
  const coinOut = out
    .filter(({ amount }) => amount.asset === plan.value.asset)
    .reduce((sum, { amount }) => sum + amount.base, 0n);
  const allowed = new Set([plan.value.asset, plan.shares?.asset, plan.votingToken]);
  return (
    steps.every((step) => step.approvals.every((item) => isPlannedApproval(item, plan, family))) &&
    out.every(({ amount }) => allowed.has(amount.asset)) &&
    coinOut <= plan.value.base
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
 * latest state. It passes when it runs, sets no allowance but a liquid unstake's own (decision
 * 0331), and moves out of the wallet no more of the chain's coin than its plan sends: a stake's amount, nothing for an unstake or a claim. A
 * step that reverts is `simulation_reverted`, any other difference `effects_differ`.
 */
export async function simulateStake(
  parts: {
    readonly simulator: TxSimulator;
    readonly family: ChainFamily;
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
  return ranAsPlanned(simulated, plan, parts.family)
    ? ok(viewOf(plan, parts.nowMs()))
    : err("effects_differ");
}

/** The view of a paper staking move, which runs nothing: what its paper plan moves. */
export function paperStakeView(plan: StakePlan, simulatedAt: number): SimulationView {
  return viewOf(plan, simulatedAt);
}
