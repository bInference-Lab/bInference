import {
  BinferenceError,
  type ChainRef,
  defineVenue,
  err,
  type Venue,
  type VenueContracts,
  type VenueDeclaration,
} from "@binference/plugin-sdk";
import { distributorFactoryName, factoryName } from "./brew-contracts.js";
import type { BrewOptions } from "./brew-options.js";
import { brewSetupsOf } from "./brew-setups.js";
import { launchEventIds } from "./contracts/brew-events.js";
import { launchFunctionJson } from "./contracts/launch-call.js";
import { createBrewLauncher } from "./create/brew-launcher.js";
import { launchPartsOf } from "./create/launch-parts.js";
import { readBrewLaunches } from "./launches/read-launches.js";

// What a launch chain declares: the factory and the distributor factory, `launch` as a launch
// wallet's alone, and the factory as a spender only a launch wallet approves, for a token first
// buy (decisions 0282 and 0283).
function launchingOn(chain: ChainRef): VenueContracts {
  return {
    chain,
    names: [factoryName, distributorFactoryName],
    calls: [
      {
        contract: factoryName,
        abi: launchFunctionJson,
        walletInputs: [],
        isLaunchWalletOnly: true,
      },
    ],
    launchWalletSpenders: [factoryName],
  };
}

/**
 * What the `brew` venue declares on each chain it serves: BrewFactory, the single-pair factory, by
 * its registry name; on each chain it launches on, among them, also the holder distributor
 * factory, `launch` as a call only a launch wallet makes, and the factory as a spender only a
 * launch wallet approves. It reads no chain, so the composition root can list the venue's
 * contracts, such as for a wallet's ceiling, before it opens any RPC.
 */
export function brewDeclaration(
  chains: readonly ChainRef[],
  launchChains: readonly ChainRef[] = [],
): VenueDeclaration {
  return {
    id: "brew",
    contracts: chains.map((chain) =>
      launchChains.includes(chain) ? launchingOn(chain) : { chain, names: [factoryName] },
    ),
  };
}

/**
 * Creates the `brew` venue (decision 0278). Brew has no curve: a launch puts the token's whole
 * supply into a PancakeSwap V3 pool, where the aggregators trade it, so the venue quotes, builds
 * and decodes no trade of its own. Its launch reading gives the launch feed each token the listed
 * single-pair factory launches, from that factory's events. Given its launch options, it launches
 * tokens through that factory from the launch wallet (decision 0283). Bad options are a fault
 * (`brew.bad_options`).
 */
export function createBrewVenue(options: BrewOptions): Venue {
  const setups = brewSetupsOf(options.chains);
  const { launches } = options;
  const launchChains = (launches?.chains ?? []).map((item) => item.chain);
  return defineVenue({
    ...brewDeclaration([...setups.keys()], launchChains),
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
    ...(launches === undefined
      ? {}
      : { launcher: createBrewLauncher(launchPartsOf(launches, setups)) }),
  });
}
