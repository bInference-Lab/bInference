import type { ChainRef, VenueContracts } from "@binference/plugin-sdk";
import { stakeCallsJson } from "./calls/stake-calls.js";

/** StakeHub's name in the chain registry: every move goes to it. */
export const stakeHubName = "stake-hub";

/** The most coin one stake may carry: 100 BNB, the owner's ruling of 2026-11-01 (decision 0325). */
const stakeCapBase = 100n * 10n ** 18n;

/**
 * What the venue declares on a chain: StakeHub, and its `delegate`, `undelegate` and `claim`,
 * none of which takes an input naming who is credited, so none pins a wallet input; `delegate`
 * carries up to 100 BNB in a ceiling rule of its own. No spender: staking approves no token.
 */
export function stakeHubContractsOn(chain: ChainRef): VenueContracts {
  const [delegate, ...rest] = stakeCallsJson;
  const call = (abi: (typeof stakeCallsJson)[number]) => ({
    contract: stakeHubName,
    abi,
    walletInputs: [],
  });
  return {
    chain,
    names: [stakeHubName],
    calls: [
      ...(delegate === undefined ? [] : [{ ...call(delegate), maxValueBase: stakeCapBase }]),
      ...rest.map(call),
    ],
  };
}
