import type { LaunchOptionValue, LaunchQuote } from "@binference/chain";
import type { Result } from "@binference/core";
import type { HostedLaunch } from "../venues/launch-calls.js";
import type { VenueFailure } from "../venues/venue-host.js";
import type { AdvanceParts } from "./advance-intent.js";
import { hostedLaunchOf, type LaunchPathOptions, type ResolvedLaunch } from "./resolve-launch.js";

/** One launch the money path runs: its ports, what moves its intent, and the resolved launch. */
export interface LaunchRun {
  readonly options: LaunchPathOptions;
  readonly parts: AdvanceParts;
  readonly resolved: ResolvedLaunch;
  /** The credential the owner proposed with, whose upload the picture must be. */
  readonly credential: string | undefined;
  readonly signal: AbortSignal;
}

// The launch as its launchpad quotes it, with binference's USD price of its pair when it has one,
// for a launchpad that works out a setting from it (decision 0280).
async function pricedLaunchOf(run: LaunchRun): Promise<HostedLaunch> {
  const { resolved, options, signal } = run;
  const price = await options.prices.usdPrice(resolved.request.pairWith, { signal });
  const hosted = hostedLaunchOf(resolved);
  return price.ok ? { ...hosted, pairUsdPrice: price.value } : hosted;
}

// The launch's settings with the values its launchpad worked out at its quote for the optional
// ones it left out, in the order the launchpad declares them (decision 0280).
function withQuotedSettings(run: LaunchRun, quote: LaunchQuote): LaunchRun {
  const { resolved } = run;
  const quoted = Object.entries(quote.settings ?? {});
  if (quoted.length === 0) {
    return run;
  }
  const declared = run.options.launch.host.launchOptions(resolved.request.venue);
  const added = quoted.flatMap(([name, value]: readonly [string, LaunchOptionValue]) => {
    const type = declared.find((option) => option.name === name)?.type;
    return type === undefined ? [] : [{ name, type, value }];
  });
  const order = declared.map((option) => option.name);
  const launchSettings = [...resolved.launchSettings, ...added].toSorted(
    (one, two) => order.indexOf(one.name) - order.indexOf(two.name),
  );
  return { ...run, resolved: { ...resolved, launchSettings } };
}

/**
 * A live launch's quote, asked with binference's USD price of its pair, and the run with the
 * settings the quote worked out (decision 0280); a paper launch is not quoted.
 */
export async function quotedRunOf(given: LaunchRun): Promise<{
  readonly run: LaunchRun;
  readonly quote: Result<LaunchQuote, VenueFailure> | undefined;
}> {
  if (given.resolved.isPaper) {
    return { run: given, quote: undefined };
  }
  const hosted = await pricedLaunchOf(given);
  const quote = await given.options.launch.host.quote(hosted, { signal: given.signal });
  return { run: quote.ok ? withQuotedSettings(given, quote.value) : given, quote };
}
