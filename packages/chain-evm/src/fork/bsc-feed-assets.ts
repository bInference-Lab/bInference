import { bsc, bscPriceFeeds } from "@binference/chains";
import { feedAssetsOf } from "../prices/feed-assets.js";
import type { FeedAsset } from "../prices/price-from-round.js";

/**
 * BSC's feed assets from the registry in `@binference/chains`, as the composition root reads them:
 * BNB and WBNB from the BNB feed, and each stablecoin at $1 while its feed holds its peg.
 */
export function bscFeedAssets(): readonly FeedAsset[] {
  return feedAssetsOf(bsc, bscPriceFeeds);
}
