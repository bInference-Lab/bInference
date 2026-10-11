import type { ChainRef } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { CeilingChain, ChainCapPlan } from "@binference/custody-privy";

// The chain with each cap at its size in `sized`, summed by the same aggregation. Another count of
// token caps is a fault, so no cap is matched to the wrong token.
function resizedCaps(chain: CeilingChain, sized: ChainCapPlan): CeilingChain {
  const { native, approvals } = chain.caps;
  if (sized.approvals.length !== approvals.length) {
    throw new BinferenceError({
      code: "cli.ceiling_unbuilt",
      message: "The ceiling names other 24-hour caps than binference sizes on its chain.",
      details: { chain: chain.chain.ref },
    });
  }
  return {
    ...chain,
    caps: {
      native: { aggregation: native.aggregation, limitBase: sized.nativeLimitBase },
      approvals: approvals.map((cap, index) => ({
        aggregation: cap.aggregation,
        limitBase: sized.approvals[index]?.limitBase ?? cap.limitBase,
      })),
    },
  };
}

/**
 * Each chain at the size asked, or as it is when no size is asked: the plans come from
 * `capPlanOn`, which sizes a chain's caps in micro-dollars at their floor prices.
 */
export function withDayCaps(
  chains: readonly CeilingChain[],
  resize: {
    readonly dayUsdMicros: bigint | undefined;
    readonly capPlanOn: (chain: ChainRef, dayUsdMicros: bigint) => ChainCapPlan;
  },
): readonly CeilingChain[] {
  const { dayUsdMicros, capPlanOn } = resize;
  return dayUsdMicros === undefined
    ? chains
    : chains.map((chain) => resizedCaps(chain, capPlanOn(chain.chain.ref, dayUsdMicros)));
}
