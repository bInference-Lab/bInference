import type { ChainRegistry } from "@binference/chain";
import type { AssetInfo, AssetInfos, LaunchView } from "@binference/protocol";
import { z } from "zod";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { StoredLaunch } from "./launch-record.js";

const blockNumberSchema = z.bigint().pipe(z.coerce.number()).pipe(z.int().nonnegative());

// A launch's token as the feed read it: its creator's words, never verified, on its curve until
// it graduates. A token whose decimals were not read has no info.
function launchedTokenInfo(launch: StoredLaunch): AssetInfo | undefined {
  const { symbol, name, decimals } = launch;
  return decimals === undefined
    ? undefined
    : {
        symbol: symbol ?? "",
        name: name ?? "",
        decimals,
        verified: false,
        onCurve: !launch.graduated,
      };
}

// The info of a launch's token and quote token: the registry's first, then the feed's words.
function launchAssetsOf(chains: ChainRegistry, launch: StoredLaunch): AssetInfos {
  const token = assetInfoOf(chains, launch.token) ?? launchedTokenInfo(launch);
  const quote = assetInfoOf(chains, launch.quoteToken);
  return {
    ...(token === undefined ? {} : { [launch.token]: token }),
    ...(quote === undefined ? {} : { [launch.quoteToken]: quote }),
  };
}

/** A stored launch as the protocol shows it (spec 1, section 8.3), with its tokens' info. */
export function launchViewOf(chains: ChainRegistry, launch: StoredLaunch): LaunchView {
  const { taxBps, snipeTaxBps, curveProgressBps } = launch;
  return {
    chain: launch.chain,
    token: launch.token,
    launchpad: launch.launchpad,
    creator: launch.creator,
    quoteToken: launch.quoteToken,
    ...(taxBps === undefined ? {} : { taxBps }),
    ...(snipeTaxBps === undefined ? {} : { snipeTaxBps }),
    ...(curveProgressBps === undefined ? {} : { curveProgressBps }),
    graduated: launch.graduated,
    insiders: launch.insiders,
    creatorLaunches30d: launch.creatorLaunches30d,
    block: blockNumberSchema.parse(launch.block),
    tx: launch.txHash,
    launchedAt: launch.launchedAtMs,
    assets: launchAssetsOf(chains, launch),
  };
}
