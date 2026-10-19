import { canonicalAsset, type ChainRegistry } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { LaunchFilter, ProtocolErrorCode } from "@binference/protocol";

/** What a launch filter is checked against: the registry, and the launchpads the engine runs. */
export interface LaunchFilterContext {
  readonly chains: ChainRegistry;
  readonly isLaunchpad: (venue: string) => boolean;
}

/**
 * A launch filter in its canonical form: every launchpad it names one the engine runs, every quote
 * token one the registry's chains hold, in its canonical id. Anything else is `protocol.bad_args`.
 */
export function checkLaunchFilter(
  context: LaunchFilterContext,
  filters: LaunchFilter,
): Result<LaunchFilter, ProtocolErrorCode> {
  const { launchpads, quoteTokens } = filters;
  if (launchpads?.some((venue) => !context.isLaunchpad(venue)) === true) {
    return err("protocol.bad_args");
  }
  const tokens = quoteTokens?.map((token) => canonicalAsset(context.chains, token));
  if (tokens?.some((token) => !token.ok) === true) {
    return err("protocol.bad_args");
  }
  const canonical = tokens?.flatMap((token) => (token.ok ? [token.value] : []));
  return ok({ ...filters, ...(canonical === undefined ? {} : { quoteTokens: canonical }) });
}
