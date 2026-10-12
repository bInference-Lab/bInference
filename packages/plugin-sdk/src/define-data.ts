import type { MarketDataSource } from "@binference/chain";
import { BinferenceError } from "@binference/core";

// A plugin's id: kebab-case, as its folder is named.
const dataIdPattern = /^[a-z][a-z0-9-]{0,31}$/;

function refuse(problem: string): BinferenceError {
  return new BinferenceError({
    code: "plugin.bad_data",
    message: `A data source's declaration is wrong: ${problem}`,
  });
}

type OptionalRead = MarketDataSource["candles"] | MarketDataSource["prices"];

// A read the port lets a source leave out: absent, or a function, whatever a plugin's types said.
const isOptionalRead = (read: OptionalRead): boolean =>
  read === undefined || typeof read === "function";

/**
 * Defines a data plugin: a market data service the agent reads, such as a token's pools and a
 * chain's trending tokens, and, where the service publishes them, a token's candles and prices.
 * It reads and never moves funds; the engine never prices a trade from it. The definition is
 * checked at once: an id that is not kebab-case, a read that is not a function, or a candle or
 * price read that is neither absent nor a function, is a fault (`plugin.bad_data`), so the plugin
 * fails when it loads, never when it is read. The returned source is frozen, has the reads the
 * definition has, and calls them on the definition.
 */
export function defineData(definition: MarketDataSource): MarketDataSource {
  const { id } = definition;
  if (typeof id !== "string" || !dataIdPattern.test(id)) {
    throw refuse("its id must be 1 to 32 of [a-z0-9-], starting with a letter.");
  }
  const canRead =
    typeof definition.pools === "function" && typeof definition.trending === "function";
  if (!canRead) {
    throw refuse(`${id} must read both pools and trending tokens.`);
  }
  if (!isOptionalRead(definition.candles) || !isOptionalRead(definition.prices)) {
    throw refuse(`${id} must read candles and prices with functions, or not at all.`);
  }
  const { candles, prices } = definition;
  const source: MarketDataSource = {
    id,
    pools: async (asset, options) => definition.pools(asset, options),
    trending: async (chain, options) => definition.trending(chain, options),
    ...(candles === undefined
      ? {}
      : {
          candles: async (asset, request, options) => candles(asset, request, options),
        }),
    ...(prices === undefined
      ? {}
      : {
          prices: async (chain, assets, options) => prices(chain, assets, options),
        }),
  };
  return Object.freeze(source);
}
