import {
  type ChainRef,
  defineLaunchpad,
  type LaunchpadVenue,
  type VenueDeclaration,
} from "@binference/plugin-sdk";
import { curveChainSetupsOf } from "@binference/plugin-sdk/evm";
import { tradeFunctionsJson } from "./contracts/genius-calls.js";
import { readCurvePrice } from "./curve/read-curve-price.js";
import { readCurve } from "./curve/read-curve.js";
import { curveName, stackFactoryNames } from "./geniusfun-contracts.js";
import type { GeniusfunOptions } from "./geniusfun-options.js";
import { readInsiders } from "./insiders/read-insiders.js";
import { createBoundedMemo } from "./launch/bounded-memo.js";
import { quoteTrade } from "./quote/quote-trade.js";
import { buildTrade } from "./router/build-trade.js";
import { decodeTrade } from "./router/decode-trade.js";
import type { VenueParts } from "./venue-parts.js";

// Launches a running engine keeps the facts and insiders of; the oldest goes first past it.
const keptLaunches = 512;

/**
 * What the `geniusfun` launchpad declares on each chain it trades on: the factory of each live
 * stack, by its registry name; each launch's own `curve` (decision 0212); the curve's `buy` and
 * `sell`, the calls its trades make, each paying the `recipient` it names, which must be the
 * wallet; the curve as the one spender; and no deadline. It reads no chain, so the composition
 * root can list the venue's contracts, such as for a wallet's ceiling, before it opens any RPC.
 * No ceiling lists a launch's curve: only a launch wallet's ceiling allows these calls, on any
 * contract, paying the wallet itself (decision 0217).
 */
export function geniusfunDeclaration(chains: readonly ChainRef[]): VenueDeclaration {
  return {
    id: "geniusfun",
    contracts: chains.map((chain) => ({
      chain,
      names: [...stackFactoryNames],
      launchContracts: [curveName],
      calls: [
        { contract: curveName, abi: tradeFunctionsJson.buy, walletInputs: ["recipient"] },
        { contract: curveName, abi: tradeFunctionsJson.sell, walletInputs: ["recipient"] },
      ],
      spenders: [curveName],
      noDeadline: true,
    })),
  };
}

/**
 * Creates the `geniusfun` launchpad: buys and sells of the tokens on Genius.fun's bonding curves,
 * one curve per launch, each found through its stack's factory and read by `eth_call` on each
 * chain's RPC failover. Its curve read says which tokens it holds and names their curves; its
 * quotes are the curve's own arithmetic to the wei, naming the creator tax and the launch-window
 * snipe tax the wallet would pay (decision 0213); its price read gives the price watcher each
 * curve's reserves every block; and it reads the wallets each launch exempted from its snipe tax
 * as the token's insiders. Bad options are a fault (`geniusfun.bad_options`).
 */
export function createGeniusfunVenue(options: GeniusfunOptions): LaunchpadVenue {
  const parts: VenueParts = {
    setups: curveChainSetupsOf(options.chains, { id: "geniusfun", name: "Genius.fun" }),
    launches: createBoundedMemo(keptLaunches),
    insiders: createBoundedMemo(keptLaunches),
  };
  return defineLaunchpad({
    ...geniusfunDeclaration([...parts.setups.keys()]),
    quote: async (request, { signal }) => quoteTrade(request, parts, signal),
    build: async (request, { signal }) => buildTrade(request, parts, signal),
    decode: (draft) => decodeTrade(draft, parts),
    curve: async (request, { signal }) => readCurve(request, parts, signal),
    priceRead: async (request, { signal }) => readCurvePrice(request, parts, signal),
    insiders: async (request, { signal }) => readInsiders(request, parts, signal),
  });
}
