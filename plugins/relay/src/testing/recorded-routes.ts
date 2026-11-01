import chains from "./recorded/chains.json" with { type: "json" };
import usdcToRobinhood from "./recorded/quote-usdc-robinhood.json" with { type: "json" };
import usdtToRobinhood from "./recorded/quote-usdt-robinhood.json" with { type: "json" };

/**
 * Relay's `GET /chains` as it answered on 2026-11-01, cut to BSC and the five chains bridges
 * deliver to, and to each chain's id, name, machine, protocol data, coin and listed tokens with
 * whether each bridges: a route is a currency both chains list as bridging (decision 0301).
 */
export const recordedChainsAnswer: string = JSON.stringify(chains);

/**
 * Relay's quotes of 20 BSC USDC and 20 BSC USDT to Robinhood Chain, recorded on 2026-11-01: each
 * fills as USDG, a currency BSC does not list, so its routes come from these quotes.
 */
export const recordedRobinhoodQuotes: readonly string[] = [
  JSON.stringify(usdcToRobinhood),
  JSON.stringify(usdtToRobinhood),
];
