import type { LiquiditySource } from "../api/liquidity-answer.schema.js";

// Pools of PancakeSwap Infinity and Uniswap v4 run a hook contract. OKX's answers name a route's
// protocols but never its pools or their hooks, so no such pool can be held to the chain's hook
// allowlist, and none is used.
const hookedName = /\binfinity\b|\bv4\b/i;

/** The names of a route's protocols whose pools run hooks the venue cannot check, each once. */
export function hookedSourcesIn(sources: readonly string[]): readonly string[] {
  return sources.filter((name) => hookedName.test(name));
}

/** OKX's DEX ids of the protocols whose pools run hooks, which every route must exclude. */
export function hookedDexIds(sources: readonly LiquiditySource[]): readonly string[] {
  return sources.filter((source) => hookedName.test(source.name)).map((source) => source.id);
}
