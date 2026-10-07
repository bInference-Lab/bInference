import type { Amount } from "@binference/chain";
import type { Answerer } from "./card-answer.js";
import type { CardLine, CardValue } from "./card-line.js";

/**
 * How a card closed: the first answer, Confirm or Cancel, or its timer. Every copy of the card on
 * every surface becomes the receipt of this closing.
 */
export type CardClosing =
  | {
      readonly outcome: "confirmed" | "denied";
      readonly answeredBy: Answerer;
      readonly atMs: number;
    }
  | { readonly outcome: "expired"; readonly atMs: number };

/** What a paper intent sold and bought at its confirmed quote, as its receipt shows the fill. */
export interface ReceiptFill {
  readonly amountIn: Amount;
  readonly amountOut: Amount;
}

function paperFillLine(fill: ReceiptFill): CardLine {
  const result: CardLine = {
    key: "receipt.result",
    values: {
      sold: { type: "amount", amount: fill.amountIn },
      bought: { type: "amount", amount: fill.amountOut },
    },
  };
  return { key: "receipt.paper", values: { result: { type: "line", line: result } } };
}

/**
 * The receipt line a card becomes when it closes (spec 4, section 3.5). A confirmed paper intent
 * passes its paper fill, and its card becomes the paper fill's receipt, flagged as paper.
 */
export function receiptLine(closing: CardClosing, paperFill?: ReceiptFill): CardLine {
  if (closing.outcome === "expired") {
    return { key: "receipt.expired", values: {} };
  }
  const surface: CardValue = { type: "choice", choice: closing.answeredBy.surface };
  if (closing.outcome === "denied") {
    return { key: "receipt.denied", values: { surface } };
  }
  return paperFill === undefined
    ? { key: "receipt.confirmed", values: { surface, time: { type: "time", atMs: closing.atMs } } }
    : paperFillLine(paperFill);
}
