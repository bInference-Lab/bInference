import type { Amount, AssetRef } from "@binference/chain";
import type { IntentReason } from "../intents/intent-reason.js";
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

/** What a fill sold and bought, as the `{result}` of a receipt shows it. */
export function receiptResult(fill: ReceiptFill): CardValue {
  const line: CardLine = {
    key: "receipt.result",
    values: {
      sold: { type: "amount", amount: fill.amountIn },
      bought: { type: "amount", amount: fill.amountOut },
    },
  };
  return { type: "line", line };
}

/**
 * How a confirmed live intent ended on chain, as its receipt shows it (spec 4, section 3.5): a
 * trade that filled, with what it sold and bought; a token launch that landed, with its new token
 * and, with a first buy, what that sold and bought; or one that failed on chain, with its reason.
 * Each names its last transaction's explorer link.
 */
export type LiveOutcome =
  | { readonly kind: "filled"; readonly fill: ReceiptFill; readonly explorerLink: string }
  | {
      readonly kind: "launched";
      readonly token: AssetRef;
      readonly fill?: ReceiptFill;
      readonly explorerLink: string;
    }
  | { readonly kind: "failed"; readonly reason: IntentReason; readonly explorerLink: string };

/** What followed a confirmation that the receipt shows: a paper fill, or a live outcome. */
export type ReceiptAfter = { readonly kind: "paper"; readonly fill: ReceiptFill } | LiveOutcome;

const text = (value: string): CardValue => ({ type: "text", text: value });

function launchedLine(outcome: Extract<LiveOutcome, { readonly kind: "launched" }>): CardLine {
  const token: CardValue = { type: "asset", asset: outcome.token };
  const explorerLink = text(outcome.explorerLink);
  return outcome.fill === undefined
    ? { key: "receipt.launchedAlone", values: { token, explorerLink } }
    : {
        key: "receipt.launched",
        values: { token, result: receiptResult(outcome.fill), explorerLink },
      };
}

// The receipt of what followed a confirmation: the paper fill, or how the live intent ended.
function afterLine(after: ReceiptAfter): CardLine {
  if (after.kind === "paper") {
    return paperFillLine(after.fill);
  }
  if (after.kind === "launched") {
    return launchedLine(after);
  }
  const explorerLink = text(after.explorerLink);
  if (after.kind === "filled") {
    return { key: "receipt.filled", values: { result: receiptResult(after.fill), explorerLink } };
  }
  const reason: CardValue = { type: "line", line: { key: `reason.${after.reason}`, values: {} } };
  return { key: "receipt.failed", values: { reason, explorerLink } };
}

/** The receipt of a paper fill, flagged as paper. */
export function paperFillLine(fill: ReceiptFill): CardLine {
  return { key: "receipt.paper", values: { result: receiptResult(fill) } };
}

/**
 * The receipt line a card becomes when it closes (spec 4, section 3.5). A confirmed intent passes
 * what followed: a paper intent its paper fill, flagged as paper, and a live intent how it ended
 * on chain, once it did; until then a confirmed card says it is sending.
 */
export function receiptLine(closing: CardClosing, after?: ReceiptAfter): CardLine {
  if (closing.outcome === "expired") {
    return { key: "receipt.expired", values: {} };
  }
  const surface: CardValue = { type: "choice", choice: closing.answeredBy.surface };
  if (closing.outcome === "denied") {
    return { key: "receipt.denied", values: { surface } };
  }
  return after === undefined
    ? { key: "receipt.confirmed", values: { surface, time: { type: "time", atMs: closing.atMs } } }
    : afterLine(after);
}
