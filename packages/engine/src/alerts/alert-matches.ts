import type { Ratio } from "@binference/core";
import type {
  ActivityItem,
  LaunchFilter,
  LaunchView,
  PriceCondition,
  WalletCondition,
} from "@binference/protocol";
import { compareRatios } from "../orders/price-level.js";

/**
 * Whether a confirmed price, in micro-dollars per whole token, is at or past a price alert's level
 * in its direction: a level, never a crossing, so a price the watcher skipped past still fires.
 */
export function priceMeets(condition: PriceCondition, wholePrice: Ratio): boolean {
  const order = compareRatios(wholePrice, { numerator: condition.price, denominator: 1n });
  return condition.direction === "above" ? order >= 0 : order <= 0;
}

/**
 * Whether a wallet's trade matches a wallet alert: the alert's account, and its side, asset and
 * least dollar value when it names them. A trade with no dollar value never meets a least one.
 */
export function tradeMatches(
  condition: WalletCondition,
  trade: { readonly account: string; readonly activity: ActivityItem },
): boolean {
  const { activity } = trade;
  const { side, asset, minUsdMicros } = condition;
  const value = activity.valueUsdMicros;
  return (
    trade.account === condition.account &&
    (side === undefined || side === activity.side) &&
    (asset === undefined || asset === activity.asset) &&
    (minUsdMicros === undefined || (value !== undefined && value >= minUsdMicros))
  );
}

/** A launch as a filter judges it: its view, and its liquidity in micro-dollars when read. */
export interface JudgedLaunch {
  readonly launch: LaunchView;
  readonly liquidityUsdMicros?: bigint;
}

const fullCurveBps = 10_000;

// A bound given holds only on a value known: an unread tax or liquidity never passes it.
const atMost = (bound: number | undefined, value: number | undefined): boolean =>
  bound === undefined || (value !== undefined && value <= bound);

// Where a launch was made: its launchpad and quote token, when the filter names them.
function placePasses(filter: LaunchFilter, launch: LaunchView): boolean {
  return (
    (filter.launchpads?.includes(launch.launchpad) ?? true) &&
    (filter.quoteTokens?.includes(launch.quoteToken) ?? true)
  );
}

// Its curve has gone at least as far as the filter asks; a graduated launch's counts as full.
function curvePasses(filter: LaunchFilter, launch: LaunchView): boolean {
  const least = filter.minCurveProgressBps;
  const progress = launch.graduated ? fullCurveBps : launch.curveProgressBps;
  return least === undefined || (progress !== undefined && progress >= least);
}

function liquidityPasses(filter: LaunchFilter, judged: JudgedLaunch): boolean {
  const deepest = filter.minLiquidityUsdMicros;
  const { liquidityUsdMicros: depth } = judged;
  return deepest === undefined || (depth !== undefined && depth >= deepest);
}

/**
 * Whether a launch passes a filter (protocol spec, section 8.4): every field given must hold, and
 * an empty filter passes every launch. A value the feed did not read never passes a bound on it.
 */
export function launchPasses(filter: LaunchFilter, judged: JudgedLaunch): boolean {
  const { launch } = judged;
  return (
    placePasses(filter, launch) &&
    curvePasses(filter, launch) &&
    liquidityPasses(filter, judged) &&
    atMost(filter.maxTaxBps, launch.taxBps) &&
    atMost(filter.maxSnipeTaxBps, launch.snipeTaxBps) &&
    atMost(filter.maxInsiders, launch.insiders.length) &&
    atMost(filter.maxCreatorLaunches30d, launch.creatorLaunches30d)
  );
}
