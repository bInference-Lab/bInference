import type { ChainRegistry } from "@binference/chain";
import type { AssetInfos } from "@binference/protocol";
import type { ReceiptFill } from "../confirmations/card-closing.js";
import { type IntentHistory, paperFillOf } from "../intents/intent-history.js";
import { assetInfosOf } from "../money-path/asset-infos.js";

/** A confirmed paper intent's fill as its receipt shows it, with the assets the fill names. */
export interface PaperReceipt {
  readonly fill: ReceiptFill;
  /** The sold and the bought asset, with their symbols and decimals. */
  readonly assets: AssetInfos;
}

/** The paper receipt of an intent once it recorded its paper fill, or `undefined` before. */
export function paperReceiptOf(
  history: IntentHistory,
  chains: ChainRegistry,
): PaperReceipt | undefined {
  const fill = paperFillOf(history);
  if (fill === undefined) {
    return undefined;
  }
  const { amountIn, amountOut } = fill;
  return {
    fill: { amountIn, amountOut },
    assets: assetInfosOf(chains, [amountIn.asset, amountOut.asset]),
  };
}
