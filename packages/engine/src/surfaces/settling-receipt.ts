import type { AssetInfos } from "@binference/protocol";
import { type ReceiptAfter, receiptLine } from "../confirmations/card-closing.js";
import type { CardLine } from "../confirmations/card-line.js";
import type { CardSettling } from "./create-card-showings.js";

/** What followed a closed card's closing, which its receipt shows, with the assets it names. */
export interface SettledAfter {
  readonly after?: ReceiptAfter;
  readonly assets: AssetInfos;
}

/** The line a closed card ends with on every surface, with the assets it names. */
export interface SettlingReceipt {
  readonly line: CardLine;
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

/**
 * The receipt line every copy of a closed card becomes (spec 4, section 3.5): how it closed, and
 * for a confirmed one what followed; until then that it is sending.
 */
export function settlingReceiptOf(settling: CardSettling): SettlingReceipt {
  const { after, assets } = settledAfterOf(settling);
  return { line: receiptLine(settling.closing, after), assets };
}
