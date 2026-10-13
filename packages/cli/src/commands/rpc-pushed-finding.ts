import type { ChainRef } from "@binference/chain";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { CheckFinding } from "./check-finding.js";

const check = "rpc.pushed";

// The enabled chains whose new blocks the price watcher polls for: config names no `wss:` URL of
// the owner's RPC for them, and a chain file's public RPCs push none.
function polledChains(config: BinferenceConfig): readonly ChainRef[] {
  return config.chains.enabled.filter((chain) => config.chains.rpc[chain]?.ws === undefined);
}

/** Whether any enabled chain's new blocks are polled for, so the check needs the live orders. */
export function hasPolledChain(config: BinferenceConfig | undefined): boolean {
  return config !== undefined && polledChains(config).length > 0;
}

/**
 * `rpc.pushed` (decision 0209) from the config and the count of live auto orders with a price
 * trigger the running engine holds: a warning while there is one and an enabled chain has no
 * `wss:` URL, so its price watcher polls for new blocks over HTTP, which can see a block up to a
 * block time late and put a live exit fill two blocks after its trigger instead of one. It
 * recommends the RPC's `wss:` URL as `ws` under `chains.rpc`. Without config, or with no engine to
 * count the orders (`undefined`), the check is skipped.
 */
export function rpcPushedOf(
  config: BinferenceConfig | undefined,
  liveOrderCount: number | undefined,
): CheckFinding {
  if (config === undefined || liveOrderCount === undefined) {
    return { check, level: "skip" };
  }
  const chains = polledChains(config);
  if (chains.length === 0 || liveOrderCount === 0) {
    return { check, level: "ok" };
  }
  return {
    check,
    level: "warn",
    message: { key: "check.rpcPushed", values: { count: liveOrderCount } },
    details: { chains: [...chains], orders: liveOrderCount },
  };
}
