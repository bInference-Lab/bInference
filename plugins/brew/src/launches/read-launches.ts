import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  bpsSchema,
  type ChainRef,
  type FoundLaunch,
  type LaunchesFound,
  type LaunchLogsRequest,
} from "@binference/plugin-sdk";
import type { Address } from "viem";
import { factoryName } from "../brew-contracts.js";
import { brewAssetOf, type BrewSetup } from "../brew-setups.js";
import { type LaunchLogs, launchLogsOf, type TokenLaunched } from "../contracts/brew-events.js";

// Every BrewToken has 18 decimals, no tax and no curve: its whole supply sits in its pool from
// the launch on (BrewFactory's and BrewToken's verified sources).
const tokenDecimals = 18;
const none: LaunchesFound = { launches: [], changes: [] };
const noTax = bpsSchema.parse(0);

const lower = (address: string): string => address.toLowerCase();
const accountOn = (chain: ChainRef, address: Address): AccountRef =>
  accountRefSchema.parse(`${chain}:${address}`);

function launchOf(setup: BrewSetup, logs: LaunchLogs, launched: TokenLaunched): FoundLaunch {
  const { chain } = setup;
  const bought = logs.bought.flatMap(({ token, recipient }) =>
    token === launched.token ? [recipient] : [],
  );
  return {
    token: brewAssetOf(launched.token, setup),
    creator: accountOn(chain, launched.creator),
    quoteAsset: brewAssetOf(launched.quoteToken, setup),
    decimals: tokenDecimals,
    graduated: true,
    insiders: [...new Set(bought)].map((recipient) => accountOn(chain, recipient)),
    index: launched.index,
    name: launched.name,
    symbol: launched.symbol,
    taxBps: noTax,
    snipeTaxBps: noTax,
  };
}

/**
 * The launches one transaction's logs tell (decision 0278): each `TokenLaunched` the listed
 * single-pair factory wrote is a launch, in the call that records it in the factory's
 * `launches(token)`, with its creator, its words and the asset its pool trades it against, the
 * chain's coin for its wrapped coin; the wallets the same factory's `InitialBuyExecuted` names for
 * that token are its insiders. A Brew token has no curve: it trades in its pool from the launch
 * on, so it reads as graduated, with no tax. A log of any other contract, such as Brew's
 * multi-pair factories, or outside its shape, is passed over; a chain the venue does not serve
 * has none.
 */
export function readBrewLaunches(
  request: LaunchLogsRequest,
  setups: ReadonlyMap<ChainRef, BrewSetup>,
): LaunchesFound {
  const setup = setups.get(request.chain);
  const factory = request.contracts[factoryName];
  if (setup === undefined || factory === undefined) {
    return none;
  }
  const by = lower(accountRefParts(factory).address);
  const logs = launchLogsOf(
    request.logs.filter((log) => lower(accountRefParts(log.emitter).address) === by),
  );
  return { launches: logs.launched.map((event) => launchOf(setup, logs, event)), changes: [] };
}
