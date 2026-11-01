import {
  assetRefParts,
  BinferenceError,
  type Bridge,
  type BridgeDestination,
  type ChainRef,
  defineBridge,
  type VenueDeclaration,
} from "@binference/plugin-sdk";
import { createRelayApi } from "./api/relay-api.js";
import { buildDeposit } from "./deposit/build-deposit.js";
import { decodeDeposit } from "./deposit/decode-deposit.js";
import { depositPageOf, depositStatus } from "./deposit/deposit-status.js";
import { relaySettlement } from "./deposit/settlement.js";
import { relayChainOf } from "./relay-chains.js";
import { relayContractsOn } from "./relay-contracts.js";
import type { RelayOptions } from "./relay-options.js";
import { quoteBridge } from "./routes/quote-bridge.js";

/** The bridge's id, which the registry names Relay's contracts and routes after. */
export const relayId = "relay";

/**
 * What the Relay bridge declares on the source chains given, without an API: its id, the
 * depository's two deposits, each a bridge wallet's alone with the depositor pinned to the wallet,
 * and the depository as a spender only a bridge wallet approves (decision 0303).
 */
export function relayDeclaration(chains: readonly ChainRef[]): VenueDeclaration {
  return { id: relayId, contracts: chains.map(relayContractsOn) };
}

function badOptions(): BinferenceError {
  return new BinferenceError({
    code: "relay.bad_options",
    message:
      "A Relay route leaves from a chain it does not declare or reaches a chain Relay names no id for.",
  });
}

// Each chain a route reaches, once, by the id Relay names it with. A route that leaves from
// another chain than those given, or reaches a chain Relay names no id for, is a fault of the
// options.
function destinationsOf(options: RelayOptions): readonly BridgeDestination[] {
  const chains = new Map<ChainRef, string>();
  for (const route of options.routes) {
    const leaves = assetRefParts(route.leaves).chain;
    const arrives = relayChainOf(assetRefParts(route.arrives).chain);
    if (arrives === undefined || !options.chains.includes(leaves)) {
      throw badOptions();
    }
    chains.set(arrives.chain, arrives.id);
  }
  return [...chains].map(([chain, id]) => ({ chain, id }));
}

/**
 * Creates the Relay bridge over an `Http` port (decisions 0322 and 0323): quotes from Relay's
 * `quote/v2` for the routes given, each held to the order its id names, signed by Relay's solver,
 * and to what was asked;
 * deposits as `depositErc20` naming that order on each chain's depository, a bridge wallet's alone
 * (decision 0303); the decoder of those deposits as order deposits (decision 0317); each deposit's
 * status from Relay's requests; and the match of a fill or refund to its deposit by the chains' own
 * events (decision 0320). It serves only the registry's routes, and only for a token that leaves
 * with a 24-hour cap (decision 0305). The owner's key, when given, goes with every request.
 */
export function createRelayBridge(options: RelayOptions): Bridge {
  const api = createRelayApi(options);
  const destinations = destinationsOf(options);
  return defineBridge({
    ...relayDeclaration(options.chains),
    destinations,
    quote: async (request, { signal }) => quoteBridge(request, { api, options }, signal),
    build: async (request, { signal }) => {
      signal.throwIfAborted();
      return await Promise.resolve(buildDeposit(request, options));
    },
    decode: (draft) => decodeDeposit(draft),
    status: async (deposit, { signal }) => depositStatus(deposit, { api, destinations }, signal),
    pageOf: (deposit) => depositPageOf(deposit),
    settlement: (check) => relaySettlement(check, options.depositories),
  });
}
