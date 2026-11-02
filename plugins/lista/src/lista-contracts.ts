import type { ChainRef, VenueContracts } from "@binference/plugin-sdk";
import { managerCallsJson } from "./calls/manager-calls.js";

/** Lista's stake manager's name in the chain registry: every move goes to it. */
export const stakeManagerName = "stake-manager";

/**
 * The most coin one stake may carry: 100 BNB, the owner's ruling of 2026-11-02, as StakeHub's
 * (decisions 0325 and 0332).
 */
const stakeCapBase = 100n * 10n ** 18n;

/**
 * What the venue declares on a chain: Lista's stake manager, and its `deposit`, `requestWithdraw`
 * and `claimWithdrawByUUID`, none of which takes an input naming who is credited, so none pins a
 * wallet input; and the stake manager as the one spender, since `requestWithdraw` pulls the
 * caller's slisBNB. `deposit` carries up to 100 BNB in a ceiling rule of its own; the other calls
 * send no coin.
 */
export function listaContractsOn(chain: ChainRef): VenueContracts {
  const [deposit, ...rest] = managerCallsJson;
  const call = (abi: (typeof managerCallsJson)[number]) => ({
    contract: stakeManagerName,
    abi,
    walletInputs: [],
  });
  return {
    chain,
    names: [stakeManagerName],
    calls: [
      ...(deposit === undefined ? [] : [{ ...call(deposit), maxValueBase: stakeCapBase }]),
      ...rest.map(call),
    ],
    spenders: [stakeManagerName],
  };
}
