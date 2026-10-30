import type { BridgeRouteDefinition } from "@binference/chain";

type Route = readonly [leaves: string, to: string, arrives: string];

/** Where a list of routes was read: the bridge, its endpoint and the day. */
interface RouteSource {
  readonly venue: string;
  readonly source: string;
  readonly checkedOn: string;
}

function routesOf(from: RouteSource, rows: readonly Route[]): BridgeRouteDefinition[] {
  return rows.map(([leaves, to, arrives]) => ({ ...from, leaves, to, arrives }));
}

const acrossRoutes: RouteSource = {
  venue: "across",
  source: "https://app.across.to/api/available-routes?originChainId=56",
  checkedOn: "2026-10-29",
};
const relayChains: RouteSource = {
  venue: "relay",
  source: "https://api.relay.link/chains",
  checkedOn: "2026-10-30",
};
const relayQuote: RouteSource = { ...relayChains, source: "https://api.relay.link/quote/v2" };

// Across: the direct routes its available-routes endpoint lists from BSC, each to a registry
// token. Its Swap API reaches Robinhood Chain's USDG only through a swap into ETH on BSC and one
// out of it on arrival, and Solana from BSC not at all, so neither is listed. Across delivers WETH
// to an account with no code as ETH.
const across = routesOf(acrossRoutes, [
  ["USDC", "ethereum", "USDC"],
  ["USDT", "ethereum", "USDT"],
  ["ETH", "ethereum", "WETH"],
  ["USDC", "base-mainnet", "USDC"],
  ["USDT", "base-mainnet", "USDT"],
  ["ETH", "base-mainnet", "WETH"],
  ["USDC", "arbitrum", "USDC"],
  ["USDT", "arbitrum", "USDT0"],
  ["ETH", "arbitrum", "WETH"],
  ["ETH", "robinhood", "WETH"],
]);

// Relay: a token bridges where its chains endpoint lists the same currency with
// `supportsBridging` on both chains. Robinhood Chain lists only ETH and USDG, which BSC does not,
// so its dollar routes are the ones Relay's quote endpoint fills from USDC and USDT as USDG.
const relay = [
  ...routesOf(relayChains, [
    ["USDC", "ethereum", "USDC"],
    ["USDT", "ethereum", "USDT"],
    ["USDC", "base-mainnet", "USDC"],
    ["USDT", "base-mainnet", "USDT"],
    ["USDC", "arbitrum", "USDC"],
    ["USDT", "arbitrum", "USDT0"],
    ["USDC", "solana", "USDC"],
    ["USDT", "solana", "USDT"],
  ]),
  ...routesOf(relayQuote, [
    ["USDC", "robinhood", "USDG"],
    ["USDT", "robinhood", "USDG"],
  ]),
];

/**
 * The routes Across and Relay serve from BSC, read from each bridge's own API. A route moves a
 * dollar stablecoin to a dollar stablecoin, or ETH to ETH; a bridge that would sell one coin for
 * another, such as BNB for ETH, is a trade and not listed.
 */
export const bscBridgeRoutes: readonly BridgeRouteDefinition[] = [...across, ...relay];
