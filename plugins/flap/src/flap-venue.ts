import {
  type ChainRef,
  defineLaunchpad,
  type LaunchpadVenue,
  type VenueDeclaration,
} from "@binference/plugin-sdk";
import { curveChainSetupsOf } from "@binference/plugin-sdk/evm";
import { readCurvePrice } from "./curve/read-curve-price.js";
import { readCurve } from "./curve/read-curve.js";
import { portalName } from "./flap-assets.js";
import type { FlapOptions } from "./flap-options.js";
import { swapFunctionJson } from "./portal/portal-calls.js";
import { quoteTrade } from "./quote/quote-trade.js";
import { buildSwap } from "./router/build-swap.js";
import { decodeSwap } from "./router/decode-swap.js";

/**
 * What the `flap` launchpad declares on each chain it trades on: the registry's Portal, its one
 * trade call `swapExactInput`, which pays the calling wallet and so pins no input, the Portal as
 * the one spender, and no deadline. It reads no chain, so the composition root can list the
 * venue's contracts, such as for a wallet's ceiling, before it opens any RPC.
 */
export function flapDeclaration(chains: readonly ChainRef[]): VenueDeclaration {
  return {
    id: "flap",
    contracts: chains.map((chain) => ({
      chain,
      names: [portalName],
      calls: [{ contract: portalName, abi: swapFunctionJson, walletInputs: [] }],
      spenders: [portalName],
      noDeadline: true,
    })),
  };
}

/**
 * Creates the `flap` launchpad: buys and sells of the tokens on Flap's bonding curves, quoted and
 * read through Flap's Portal by `eth_call` on each chain's RPC failover. On each chain it declares
 * the registry's Portal: its trades call the Portal's `swapExactInput` alone, which pays the
 * calling wallet and takes no deadline, so the chain declares `noDeadline`, and an approval names
 * only the Portal. Its curve read says which tokens Flap holds, and its quotes name the tax the
 * Portal takes on the curve. Its price read gives the price watcher the Portal's own curve price
 * of a token each block. Bad options are a fault (`flap.bad_options`).
 */
export function createFlapVenue(options: FlapOptions): LaunchpadVenue {
  const parts = { setups: curveChainSetupsOf(options.chains, { id: "flap", name: "Flap" }) };
  return defineLaunchpad({
    ...flapDeclaration([...parts.setups.keys()]),
    quote: async (request, { signal }) => quoteTrade(request, parts, signal),
    build: async (request, { signal }) => buildSwap(request, parts, signal),
    decode: (draft) => decodeSwap(draft, parts),
    curve: async (request, { signal }) => readCurve(request, parts, signal),
    priceRead: async (request, { signal }) => readCurvePrice(request, parts, signal),
  });
}
