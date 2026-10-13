import { type AssetRef, assetRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import type { TestOrders } from "../program/cli-host.js";
import { crashUsdt } from "./crash-market.js";

/** The crash chain's USDT as an asset, the token every crash order buys. */
export const crashUsdtAsset: AssetRef = assetRefSchema.parse(`${bsc.id}/erc20:${crashUsdt}`);

/** USDT at $1: one micro-dollar for 10^12 of its 18-decimal base units. */
const oneDollar = { numerator: 1n, denominator: 10n ** 12n };

/**
 * The crash engine's prices in place of the price watchers: USDT at $1, handed to the price
 * triggers once a BSC block time, so an active order whose condition holds fires at every block,
 * through a forced stop and after the restart, as a watcher would hand it on.
 */
export function crashTestOrders(): TestOrders {
  const price = { token: crashUsdtAsset, usdPerBaseUnit: oneDollar, decimals: 18, isThin: false };
  return {
    canPrice: (token) => token === crashUsdtAsset,
    start(see) {
      const stopping = new AbortController();
      const timer = setInterval(() => {
        see(price, { signal: stopping.signal }).catch(() => undefined);
      }, bsc.blockTimeMs);
      return () => {
        clearInterval(timer);
        stopping.abort();
      };
    },
  };
}
