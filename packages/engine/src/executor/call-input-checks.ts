import type { CallInputCheck, RegisteredChain, VenueDeclaration } from "@binference/chain";

/**
 * What the inputs of the calls the route's venues declare on a chain must be, as the venues
 * declare it (decision 0302): each input pinned to the wallet, such as a swap's receiver or a
 * deposit's depositor, and each `bytes` input a bridge deposit keeps empty. A call that pins and
 * empties nothing adds no check. A bridge deposit's recipient, chain and least output come from the
 * confirmed plan, which the bridge intent adds.
 */
export function callInputChecksOf(
  chain: RegisteredChain,
  venues: readonly VenueDeclaration[],
): readonly CallInputCheck[] {
  return venues
    .flatMap((venue) => venue.contracts.filter((item) => item.chain === chain.ref))
    .flatMap((item) => item.calls ?? [])
    .flatMap(({ abi, walletInputs, bridge }): readonly CallInputCheck[] => {
      const empty = bridge?.emptyInputs ?? [];
      return walletInputs.length === 0 && empty.length === 0
        ? []
        : [{ abi, wallet: walletInputs, equal: {}, empty, atLeast: {} }];
    });
}
