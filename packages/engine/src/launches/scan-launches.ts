import { type Clock, ok, type Result } from "@binference/core";
import type {
  ArgsOf,
  AssetInfos,
  ProtocolErrorCode,
  ResultOf,
  ScanItem,
} from "@binference/protocol";
import { launchQueryOf, type LaunchReadOptions } from "./launch-query.js";
import type { StoredLaunch } from "./launch-record.js";
import { launchAssetsOf } from "./launch-view-of.js";

const defaultScanLimit = 20;
// `market/scan` reads the launches of the last 24 hours.
const scanWindowMs = 86_400_000;

function scanItemOf(launch: StoredLaunch): ScanItem {
  const { curveProgressBps } = launch;
  return {
    asset: launch.token,
    launchpad: launch.launchpad,
    launchedAt: launch.launchedAtMs,
    ...(curveProgressBps === undefined ? {} : { curveProgressBps }),
    graduated: launch.graduated,
  };
}

/**
 * `market/scan` with `source: launches` (protocol spec, section 7.3): the chain's launches of the
 * last 24 hours, newest first, through the filters, at most `limit` (20 unless given), each with
 * its launchpad, time and curve, and its tokens' info.
 */
export async function scanLaunches(
  options: LaunchReadOptions & { readonly clock: Clock },
  args: ArgsOf<"market/scan">,
  signal: AbortSignal,
): Promise<Result<ResultOf<"market/scan">, ProtocolErrorCode>> {
  const query = launchQueryOf(options, { ...args, limit: args.limit ?? defaultScanLimit });
  if (!query.ok) {
    return query;
  }
  if (query.value === undefined) {
    return ok({ items: [], assets: {} });
  }
  const fromMs = Math.max(0, options.clock.now() - scanWindowMs);
  const launches = await options.launches.list({ ...query.value, fromMs }, { signal });
  const assets: AssetInfos = Object.fromEntries(
    launches.flatMap((launch) => Object.entries(launchAssetsOf(options.chains, launch))),
  );
  return ok({ items: launches.map(scanItemOf), assets });
}
