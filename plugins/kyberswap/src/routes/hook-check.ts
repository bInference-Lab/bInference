import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import { type Address, zeroAddress } from "viem";
import type { RouteHop } from "../api/route-answer.schema.js";

// KyberSwap's DEX ids for pools that run a hook contract: PancakeSwap Infinity and Uniswap v4.
const hookedFamilies = ["pancake-infinity", "uniswap-v4"];

function isHookedFamily(hop: RouteHop): boolean {
  return hookedFamilies.some(
    (family) => hop.exchange.startsWith(family) || hop.poolType.startsWith(family),
  );
}

// A pool passes when it names no hook and is no hooked kind, names the zero address, or names an
// allowed hook. A hooked pool that names no readable hook does not pass.
function passes(hop: RouteHop, allowedHooks: ReadonlySet<Address>): boolean {
  if (hop.hookAddress === undefined) {
    return !isHookedFamily(hop);
  }
  const hook = parseEvmAddress(hop.hookAddress);
  return hook.ok && (hook.value === zeroAddress || allowedHooks.has(hook.value));
}

/**
 * The DEX ids of a route's pools whose hook is not on the allowlist, each once. A route with any is
 * dropped: the one hook allowlist covers every route, aggregators included. An empty list is a
 * route whose every pool, candidates included, runs no hook or an allowed one.
 */
export function unlistedHookSources(
  hops: readonly RouteHop[],
  allowedHooks: ReadonlySet<Address>,
): readonly string[] {
  const failing = hops.filter((hop) => !passes(hop, allowedHooks)).map((hop) => hop.exchange);
  return [...new Set(failing)].toSorted();
}
