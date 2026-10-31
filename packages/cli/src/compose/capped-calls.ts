import type { ChainRef } from "@binference/chain";
import { err, type Result } from "@binference/core";
import {
  addPlannedCaps,
  type CallsRefusal,
  capsWithTokens,
  type CeilingChain,
  type ChainCaps,
  type ChainCapPlan,
  isPrivyId,
  planCeilingCalls,
  type PlannedEdits,
  type PrivyApi,
  type PrivyId,
} from "@binference/custody-privy";

/** The caps a change of calls made on each chain, by chain id, for the next ceilings it writes. */
export type GrownCaps = Map<string, ChainCaps>;

/** A ceiling's calls to write, and whose quorum owns any cap the write makes. */
export interface CappedCallsTarget {
  readonly policy: PrivyId;
  readonly chains: readonly CeilingChain[];
  /** The owner key's quorum, which owns the ceiling; null when Privy names none. */
  readonly owner: string | null;
}

/** How a change of calls plans the ceiling, and where it finds and keeps the caps it makes. */
export interface CappedCallsInput {
  readonly api: PrivyApi;
  readonly signal: AbortSignal;
  /** The plan of a chain's 24-hour caps, as init sizes them. */
  readonly capPlanOn: (chain: ChainRef) => ChainCapPlan;
  readonly grown: GrownCaps;
}

// Each chain with its token caps named by their place in the plan; a chain whose caps the plan
// cannot name keeps them unnamed, so custody refuses a bridge route that needs one.
function named(chains: readonly CeilingChain[], input: CappedCallsInput): readonly CeilingChain[] {
  return chains.map((chain) => {
    const grown = input.grown.get(String(chain.chain.chainId));
    const caps = grown ?? capsWithTokens(chain.caps, input.capPlanOn(chain.chain.ref));
    return caps === undefined ? chain : { ...chain, caps };
  });
}

// Each chain with the token caps its plan names past those it holds, made on Privy once for every
// ceiling of the change; undefined when one cannot be made.
async function grownChains(
  target: { readonly chains: readonly CeilingChain[]; readonly owner: PrivyId },
  input: CappedCallsInput,
): Promise<readonly CeilingChain[] | undefined> {
  const chains: CeilingChain[] = [];
  for (const chain of target.chains) {
    const chainId = String(chain.chain.chainId);
    const plan = input.capPlanOn(chain.chain.ref);
    const known = input.grown.get(chainId);
    const request = { held: chain.caps, plan, owner: target.owner };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time: a fault stops the rest
    const made = known === undefined ? await addPlannedCaps(input.api, request, input) : undefined;
    const caps = known ?? (made?.ok === true ? made.value : undefined);
    if (caps === undefined) {
      return undefined;
    }
    input.grown.set(chainId, caps);
    chains.push({ ...chain, caps });
  }
  return chains;
}

/**
 * Plans a ceiling's calls with each token cap named by its place in the plan, writing no rule.
 * When custody refuses a bridge route whose token has no 24-hour cap (decision 0305), as a ceiling
 * made before that token's cap joined the plan does, it makes the caps the plan names past those
 * the ceiling holds and plans again, so the change that first adds such a route adds its cap too,
 * or adds neither. The caps it makes serve every later ceiling of the same change.
 */
export async function planCappedCalls(
  target: CappedCallsTarget,
  input: CappedCallsInput,
): Promise<Result<PlannedEdits, CallsRefusal>> {
  const { api, signal } = input;
  const chains = named(target.chains, input);
  const planned = await planCeilingCalls(api, { policy: target.policy, chains }, { signal });
  const { owner } = target;
  if (planned.ok || planned.error !== "uncapped_token" || owner === null || !isPrivyId(owner)) {
    return planned;
  }
  const grown = await grownChains({ chains, owner }, input);
  return grown === undefined
    ? err("uncapped_token")
    : planCeilingCalls(api, { policy: target.policy, chains: grown }, { signal });
}
