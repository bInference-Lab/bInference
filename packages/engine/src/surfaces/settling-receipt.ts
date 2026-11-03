import type { AssetInfos } from "@binference/protocol";
import type { ReceiptAfter } from "../confirmations/card-closing.js";
import type { CardSettling } from "./create-card-showings.js";

/** What followed a closed card's closing, which its receipt shows, with the assets it names. */
export interface SettledAfter {
  readonly after?: ReceiptAfter;
  readonly assets: AssetInfos;
}

/**
 * What followed a closed card's confirmation, as its receipt shows it on every surface (spec 4,
 * section 3.5): its paper fill, flagged as paper, what it took effect as, or how it ended on
 * chain; nothing while it is still sending, and for a card cancelled or expired.
 */
export function settledAfterOf(settling: CardSettling): SettledAfter {
  const { paper, written, live } = settling;
  const after: ReceiptAfter | undefined =
    paper === undefined ? (written ?? live)?.outcome : { kind: "paper", fill: paper.fill };
  const assets = { ...live?.assets, ...written?.assets, ...paper?.assets };
  return after === undefined ? { assets } : { after, assets };
}
