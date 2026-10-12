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

/**
 * Defines a data plugin: a market data service the agent reads, such as a token's pools and a
 * chain's trending tokens. It reads and never moves funds; the engine never prices a trade from
 * it. The definition is checked at once: an id that is not kebab-case, or a read that is not a
 * function, is a fault (`plugin.bad_data`), so the plugin fails when it loads, never when it is
 * read. The returned source is frozen, and calls its reads on the definition.
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
  const source: MarketDataSource = {
    id,
    pools: async (asset, options) => definition.pools(asset, options),
    trending: async (chain, options) => definition.trending(chain, options),
  };
  return Object.freeze(source);
}
