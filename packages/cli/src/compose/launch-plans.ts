import type { VenueDeclaration } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type CeilingChainPlan, launchCeilingOf } from "@binference/custody-privy";

// The plan with the launch rules the install's launchpads declare on its chain, or as it is when
// they declare none there.
function withLaunch(plan: CeilingChainPlan, venues: readonly VenueDeclaration[]): CeilingChainPlan {
  const launch = launchCeilingOf(plan.chain.ref, venues);
  if (!launch.ok) {
    throw new BinferenceError({
      code: "cli.ceiling_unbuilt",
      message: `A launchpad declares a call on ${plan.chain.ref} that is no JSON ABI entry.`,
      details: { chain: plan.chain.ref, problem: launch.error },
    });
  }
  return launch.value === undefined ? plan : { ...plan, launch: launch.value };
}

/**
 * A launch wallet's chains (decision 0217): each chain's plan with the launch rules of every
 * launchpad the install runs, whichever venues the agent uses, since the rules name no contract.
 * A launchpad's call that is no JSON ABI entry is a fault of this build.
 */
export function launchPlansOf(
  plans: readonly CeilingChainPlan[],
  venues: readonly VenueDeclaration[],
): readonly CeilingChainPlan[] {
  return plans.map((plan) => withLaunch(plan, venues));
}
