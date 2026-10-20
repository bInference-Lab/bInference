import {
  BinferenceError,
  type ChainRef,
  defineVenue,
  err,
  type Venue,
  type VenueDeclaration,
} from "@binference/plugin-sdk";
import { factoryName } from "./brew-contracts.js";
import type { BrewOptions } from "./brew-options.js";
import { brewSetupsOf } from "./brew-setups.js";
import { launchEventIds } from "./contracts/brew-events.js";
import { readBrewLaunches } from "./launches/read-launches.js";

/**
 * What the `brew` venue declares on each chain it serves: BrewFactory, the single-pair factory, by
 * its registry name. It reads no chain, so the composition root can list the venue's contracts
 * before it opens any RPC.
 */
export function brewDeclaration(chains: readonly ChainRef[]): VenueDeclaration {
  return { id: "brew", contracts: chains.map((chain) => ({ chain, names: [factoryName] })) };
}

/**
 * Creates the `brew` venue (decision 0278). Brew has no curve: a launch puts the token's whole
 * supply into a PancakeSwap V3 pool, where the aggregators trade it, so the venue quotes, builds
 * and decodes no trade of its own. Its launch reading gives the launch feed each token the listed
 * single-pair factory launches, from that factory's events. Bad options are a fault
 * (`brew.bad_options`).
 */
export function createBrewVenue(options: BrewOptions): Venue {
  const setups = brewSetupsOf(options.chains);
  return defineVenue({
    ...brewDeclaration([...setups.keys()]),
    quote: async (_request, { signal }) => {
      signal.throwIfAborted();
      return Promise.resolve(err("no_route"));
    },
    build: async () =>
      Promise.reject(
        new BinferenceError({
          code: "brew.no_trade",
          message: "Brew trades nothing itself; its tokens trade in their pools.",
        }),
      ),
    decode: () => err("unknown_call"),
    launchEvents: launchEventIds,
    readLaunches: (request) => readBrewLaunches(request, setups),
  });
}
