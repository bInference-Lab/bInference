import type { ChainRef, ChainRegistry } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { LaunchFilter, ProtocolErrorCode } from "@binference/protocol";
import { checkLaunchFilter } from "./check-launch-filter.js";
import type { LaunchQuery } from "./launch-record.js";
import type { LaunchStore } from "./ports.js";

/** What the launch reads read: the stored launches, the registry and the launchpads run. */
export interface LaunchReadOptions {
  readonly launches: Pick<LaunchStore, "list">;
  readonly chains: ChainRegistry;
  readonly isLaunchpad: (venue: string) => boolean;
}

/**
 * The store's query of a chain's launches through the filters, which must name launchpads the
 * engine runs and quote tokens the registry holds, else `protocol.bad_args`, as must the chain;
 * `undefined` when a least liquidity is asked, which no launch the feed read passes.
 */
export function launchQueryOf(
  options: LaunchReadOptions,
  asked: { readonly chain: ChainRef; readonly filters?: LaunchFilter; readonly limit: number },
): Result<LaunchQuery | undefined, ProtocolErrorCode> {
  const chain = options.chains.get(asked.chain);
  if (!chain.ok) {
    return err("protocol.bad_args");
  }
  const empty: LaunchFilter = {};
  const checked =
    asked.filters === undefined ? ok(empty) : checkLaunchFilter(options, asked.filters);
  if (!checked.ok) {
    return checked;
  }
  const { minLiquidityUsdMicros, ...filters } = checked.value;
  return minLiquidityUsdMicros === undefined
    ? ok({ chain: chain.value.ref, filters, limit: asked.limit })
    : ok(undefined);
}
