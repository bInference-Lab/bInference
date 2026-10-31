import type { CallInputCheck, RegisteredChain, VenueDeclaration } from "@binference/chain";

/**
 * What the inputs of the calls the route's venues declare on a chain must be, as the venues
 * declare it (decision 0302): each input pinned to the wallet, such as a swap's receiver or a
 * deposit's depositor, and each `bytes` input a bridge deposit keeps empty. A call that pins and
 * empties nothing adds no check. A bridge deposit's check is marked with its recipient and chain
 * inputs, whose values and least output the confirmed plan names; until the bridge intent adds
 * them, the signer refuses every deposit.
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
      const check = { abi, wallet: walletInputs, equal: {}, empty, atLeast: {} };
      if (bridge !== undefined) {
        const { recipient, destinationChain } = bridge;
        return [{ ...check, bridge: { recipient, destinationChain } }];
      }
      return walletInputs.length === 0 && empty.length === 0 ? [] : [check];
    });
}
