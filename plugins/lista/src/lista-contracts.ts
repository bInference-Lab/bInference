import type { ChainRef, VenueContracts } from "@binference/plugin-sdk";
import { managerCallsJson } from "./calls/manager-calls.js";

/** Lista's stake manager's name in the chain registry: every move goes to it. */
export const stakeManagerName = "stake-manager";

/**
 * What the venue declares on a chain: Lista's stake manager, and its `deposit`, `requestWithdraw`
 * and `claimWithdrawByUUID`, none of which takes an input naming who is credited, so none pins a
 * wallet input; and the stake manager as the one spender, since `requestWithdraw` pulls the
 * caller's slisBNB. No call carries a cap of its own: a stake keeps the wallet's cap per call.
 */
export function listaContractsOn(chain: ChainRef): VenueContracts {
  return {
    chain,
    names: [stakeManagerName],
    calls: managerCallsJson.map((abi) => ({ contract: stakeManagerName, abi, walletInputs: [] })),
    spenders: [stakeManagerName],
  };
}
