import type { LaunchLog } from "@binference/plugin-sdk";
import { decodeLog } from "@binference/plugin-sdk/evm";
import { type Address, parseAbi, toEventSelector } from "viem";

// The events a Brew launch writes, as BrewFactory's verified source declares them: `TokenLaunched`
// for each launch, with the token's words and its pool, in the call that records the launch in
// `launches(token)`; `InitialBuyExecuted` for its first buy, in the same call.
const launchEvents = parseAbi([
  "event TokenLaunched(address indexed token, address indexed creator, address indexed quoteToken, address pool, uint24 fee, int24 initialTick, uint256 totalSupply, uint256[] lockedPositionIds, string name, string symbol, string metadataURI)",
  "event InitialBuyExecuted(address indexed token, address indexed recipient, uint256 quoteSpent, uint256 tokensOut)",
]);

/** The ids of the launch events the launch feed reads, as lowercase topic0 hex. */
export const launchEventIds: readonly string[] = launchEvents.map((event) =>
  toEventSelector(event).toLowerCase(),
);

/** A launch a `TokenLaunched` log tells, with its log's index. */
export interface TokenLaunched {
  readonly index: number;
  readonly token: Address;
  readonly creator: Address;
  readonly quoteToken: Address;
  readonly name: string;
  readonly symbol: string;
}

/** A first buy an `InitialBuyExecuted` log tells: the token bought and who received it. */
interface FirstBuyOf {
  readonly token: Address;
  readonly recipient: Address;
}

/** What the factory's logs of one transaction tell: its launches and its first buys. */
export interface LaunchLogs {
  readonly launched: readonly TokenLaunched[];
  readonly bought: readonly FirstBuyOf[];
}

/** The launches and first buys among the logs, each in log order; any other log is passed over. */
export function launchLogsOf(logs: readonly LaunchLog[]): LaunchLogs {
  const launched: TokenLaunched[] = [];
  const bought: FirstBuyOf[] = [];
  for (const log of logs) {
    const decoded = decodeLog(launchEvents, log);
    if (decoded?.eventName === "TokenLaunched") {
      const { token, creator, quoteToken, name, symbol } = decoded.args;
      launched.push({ index: log.index, token, creator, quoteToken, name, symbol });
    } else if (decoded?.eventName === "InitialBuyExecuted") {
      bought.push({ token: decoded.args.token, recipient: decoded.args.recipient });
    }
  }
  return { launched, bought };
}
