import type { Amount, AssetRef } from "@binference/chain";
import { addressPartOf, shortAddress } from "@binference/engine/surfaces";
import type { AssetInfos, CardValueView } from "@binference/protocol";

function tokenOf(asset: AssetRef): CardValueView {
  return { type: "text", text: shortAddress(addressPartOf(asset)) };
}

/**
 * An asset as a reply names it: its symbol when the reply carries its info, else its short
 * address, as the card does for an unverified token.
 */
export function assetValue(asset: AssetRef, assets: AssetInfos): CardValueView {
  return assets[asset] === undefined ? tokenOf(asset) : { type: "asset", asset };
}

/**
 * An amount as a reply names it: in the token's units when the reply carries its info, else in
 * base units of the token's short address, since its decimals are not known.
 */
export function amountValue(amount: Amount, assets: AssetInfos): CardValueView {
  if (assets[amount.asset] !== undefined) {
    return { type: "amount", amount };
  }
  const base: CardValueView = { type: "choice", choice: amount.base.toString() };
  return {
    type: "line",
    line: { key: "cmd.baseUnits", values: { base, token: tokenOf(amount.asset) } },
  };
}
