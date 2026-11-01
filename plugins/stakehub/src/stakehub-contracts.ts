import type { ChainRef, VenueContracts } from "@binference/plugin-sdk";
import { stakeCallsJson } from "./calls/stake-calls.js";

/** StakeHub's name in the chain registry: every move goes to it. */
export const stakeHubName = "stake-hub";

/**
 * What the venue declares on a chain: StakeHub, and its `delegate`, `undelegate` and `claim`,
 * none of which takes an input naming who is credited, so none pins a wallet input. No spender:
 * staking approves no token.
 */
export function stakeHubContractsOn(chain: ChainRef): VenueContracts {
  return {
    chain,
    names: [stakeHubName],
    calls: stakeCallsJson.map((abi) => ({ contract: stakeHubName, abi, walletInputs: [] })),
  };
}
