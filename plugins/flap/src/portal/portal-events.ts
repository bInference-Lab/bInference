import type { LaunchLog } from "@binference/plugin-sdk";
import { type Address, decodeEventLog, type Hex, isHex, parseAbi, toEventSelector } from "viem";

// The Portal's events a launch and its curve write, as Flap's docs list them for indexers ("Index
// Token Created Events") and its verified implementation declares them. None is indexed.
// - `TokenCreated`: every launch, with the token, its creator, name and symbol.
// - `TokenQuoteSet`: the token the curve trades against; missing means the chain's coin.
// - `FlapTokenTaxSet`: the higher of the buy and sell tax in basis points; missing means none.
// - `TokenBought`: a buy on the curve, the launch's own first buys among them.
// - `FlapTokenProgressChanged`: the curve's progress, 0 to 10^18 for a full curve.
// - `LaunchedToDEX`: the token left its curve for a pool.
const portalEvents = parseAbi([
  "event TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta)",
  "event TokenQuoteSet(address token, address quoteToken)",
  "event FlapTokenTaxSet(address token, uint256 tax)",
  "event TokenBought(uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice)",
  "event FlapTokenProgressChanged(address token, uint256 newProgress)",
  "event LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth)",
]);

/** The ids of the Portal's events the launch feed reads, as lowercase topic0 hex. */
export const portalEventIds: readonly string[] = portalEvents.map((event) =>
  toEventSelector(event).toLowerCase(),
);

/** One Portal event the venue reads, with its log's index. */
export type PortalEvent = { readonly index: number } & (
  | {
      readonly kind: "created";
      readonly token: Address;
      readonly creator: Address;
      readonly name: string;
      readonly symbol: string;
    }
  | { readonly kind: "quote"; readonly token: Address; readonly quoteToken: Address }
  | { readonly kind: "tax"; readonly token: Address; readonly taxBps: bigint }
  | { readonly kind: "bought"; readonly token: Address; readonly buyer: Address }
  | { readonly kind: "progress"; readonly token: Address; readonly progress: bigint }
  | { readonly kind: "graduated"; readonly token: Address }
);

// The log's topics and data as viem decodes them; a part that is no hex reads as no event.
function wireOf(log: LaunchLog): { topics: [Hex, ...Hex[]]; data: Hex } | undefined {
  const [first, ...rest] = log.topics;
  const topics = rest.filter((topic) => isHex(topic));
  if (first === undefined || !isHex(first) || !isHex(log.data) || topics.length !== rest.length) {
    return undefined;
  }
  return { topics: [first, ...topics], data: log.data };
}

function decoded(log: LaunchLog) {
  const wire = wireOf(log);
  if (wire === undefined) {
    return undefined;
  }
  try {
    return decodeEventLog({ abi: portalEvents, ...wire, strict: true });
  } catch {
    return undefined;
  }
}

type Decoded = NonNullable<ReturnType<typeof decoded>>;

function eventOf(event: Decoded, index: number): PortalEvent {
  if (event.eventName === "TokenCreated") {
    const { token, creator, name, symbol } = event.args;
    return { kind: "created", index, token, creator, name, symbol };
  }
  if (event.eventName === "TokenQuoteSet") {
    return { kind: "quote", index, ...event.args };
  }
  if (event.eventName === "FlapTokenTaxSet") {
    return { kind: "tax", index, token: event.args.token, taxBps: event.args.tax };
  }
  if (event.eventName === "TokenBought") {
    return { kind: "bought", index, token: event.args.token, buyer: event.args.buyer };
  }
  if (event.eventName === "FlapTokenProgressChanged") {
    return { kind: "progress", index, token: event.args.token, progress: event.args.newProgress };
  }
  return { kind: "graduated", index, token: event.args.token };
}

/** A log the Portal wrote, as one of its events the venue reads; any other is undefined. */
export function portalEventOf(log: LaunchLog): PortalEvent | undefined {
  const event = decoded(log);
  return event === undefined ? undefined : eventOf(event, log.index);
}
