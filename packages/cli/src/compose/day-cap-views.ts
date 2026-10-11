import { type ChainRef, chainRefSchema } from "@binference/chain";
import { type DayCap, dayCapWindowSeconds, type HeldCaps } from "@binference/custody-privy";
import type { DayCapView } from "@binference/protocol";
import type { CapAsset, CapAssets } from "../init/ceiling-request.js";

// A cap as `ceiling/get` shows it: its size in units and in dollars at its floor, rounded down.
function viewOf(cap: DayCap, asset: CapAsset): DayCapView {
  return {
    asset: asset.asset,
    limit: cap.limitBase,
    windowSeconds: dayCapWindowSeconds,
    floorUsdMicros: (cap.limitBase * asset.floorUsd) / 10n ** BigInt(asset.decimals),
  };
}

/**
 * The 24-hour caps a ceiling names, as `ceiling/get` shows them (decision 0149): on each chain the
 * native coin's, then each capped token's. The approval rule names the token caps in the order
 * the chain's data lists the tokens, as init made them, so each is matched to its token by place.
 * A chain whose assets are unknown here shows no caps, and a cap past the listed tokens none.
 */
export function dayCapViewsOf(
  held: readonly HeldCaps[],
  assetsOn: (chain: ChainRef) => CapAssets | undefined,
): readonly DayCapView[] {
  return held.flatMap(({ chainId, caps }) => {
    const assets = assetsOn(chainRefSchema.parse(`eip155:${chainId}`));
    if (assets === undefined) {
      return [];
    }
    const approvals = caps.approvals.flatMap((cap, index) => {
      const token = assets.tokens[index];
      return token === undefined ? [] : [viewOf(cap, token)];
    });
    return [viewOf(caps.native, assets.native), ...approvals];
  });
}
