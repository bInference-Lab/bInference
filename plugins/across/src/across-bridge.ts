import {
  assetRefParts,
  BinferenceError,
  type Bridge,
  type BridgeDestination,
  type ChainRef,
  defineBridge,
  type VenueDeclaration,
} from "@binference/plugin-sdk";
import { eip155ChainIdOf } from "@binference/plugin-sdk/evm";
import { acrossContractsOn } from "./across-contracts.js";
import type { AcrossOptions } from "./across-options.js";
import { createAcrossApi } from "./api/across-api.js";
import { buildDeposit } from "./deposit/build-deposit.js";
import { decodeDeposit } from "./deposit/decode-deposit.js";
import { depositStatus } from "./deposit/deposit-status.js";
import { quoteBridge } from "./routes/quote-bridge.js";

/** The bridge's id, which the registry names Across's contracts and routes after. */
export const acrossId = "across";

/**
 * What the Across bridge declares on the source chains given, without an API: its id, the
 * SpokePool, `depositV3` with the inputs a ceiling binds, and the SpokePool as the one spender.
 */
export function acrossDeclaration(chains: readonly ChainRef[]): VenueDeclaration {
  return { id: acrossId, contracts: chains.map(acrossContractsOn) };
}

// Each chain a route reaches, once, by the EIP-155 id Across names it with. A route that leaves
// from another chain than those given, or reaches a chain outside EIP-155, is a fault of the
// options: Across's deposit on BNB Smart Chain names a 20-byte recipient only.
function destinationsOf(options: AcrossOptions): readonly BridgeDestination[] {
  const chains = new Map<ChainRef, string>();
  for (const route of options.routes) {
    const leaves = assetRefParts(route.leaves).chain;
    const arrives = assetRefParts(route.arrives).chain;
    const id = eip155ChainIdOf(arrives);
    if (id === undefined || !options.chains.includes(leaves)) {
      throw new BinferenceError({
        code: "across.bad_options",
        message: "An Across route leaves from a chain it does not declare or reaches no EVM chain.",
      });
    }
    chains.set(arrives, id.toString());
  }
  return [...chains].map(([chain, id]) => ({ chain, id }));
}

/**
 * Creates the Across bridge over an `Http` port, keyless (decision 0315): quotes from Across's Swap
 * API for the routes given, deposits re-encoded as `depositV3` on each chain's SpokePool (decision
 * 0302), the decoder of those deposits, and each deposit's status from Across's API. It serves
 * only the registry's routes, and only for a token that leaves with a 24-hour cap (decision 0305).
 */
export function createAcrossBridge(options: AcrossOptions): Bridge {
  const api = createAcrossApi(options.http);
  const destinations = destinationsOf(options);
  return defineBridge({
    ...acrossDeclaration(options.chains),
    destinations,
    quote: async (request, { signal }) => quoteBridge(request, { api, options }, signal),
    build: async (request, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve(buildDeposit(request, options));
    },
    decode: (draft) => decodeDeposit(draft, destinations),
    status: async (deposit, { signal }) => depositStatus(deposit, { api, destinations }, signal),
  });
}
