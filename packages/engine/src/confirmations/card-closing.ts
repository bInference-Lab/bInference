import type { Amount, AssetRef, TxHash } from "@binference/chain";
import type { IntentReason } from "../intents/intent-reason.js";
import { type CardAction, type CardActionFacts, orderTermsOf } from "./card-action.js";
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
 * Where a receipt points for the last transaction an intent sent: its page on the first block
 * explorer the chain registry lists, or its hash when the registry lists none for the chain.
 */
export type ReceiptTx = { readonly explorerLink: string } | { readonly hash: TxHash };

/**
 * How a confirmed live intent ended on chain, as its receipt shows it (spec 4, section 3.5): a
 * trade that filled, with what it sold and bought; a token launch that landed, with its new token
 * and, with a first buy, what that sold and bought; any other intent that landed, such as a send
 * or a rescue; one that failed on chain, with its reason; each with its last transaction. One that
 * reconciled with nothing sent is done; one that ended before anything was sent gives its reason
 * when it stored one; one whose fate is not known yet says so.
 */
export type LiveOutcome =
  | { readonly kind: "filled"; readonly fill: ReceiptFill; readonly tx: ReceiptTx }
  | {
      readonly kind: "launched";
      readonly token: AssetRef;
      readonly fill?: ReceiptFill;
      readonly tx: ReceiptTx;
    }
  | { readonly kind: "landed"; readonly tx: ReceiptTx }
  | { readonly kind: "done" }
  | { readonly kind: "refused"; readonly reason: IntentReason }
  | { readonly kind: "unsent" }
  | { readonly kind: "unknown" }
  | { readonly kind: "failed"; readonly reason: IntentReason; readonly tx: ReceiptTx };

/**
 * What a confirmed intent with nothing to send took effect as (spec 4, section 3.5): an unfreeze,
 * with the agents its card named; an auto order's card, with the order it made active, or why the
 * order did not start, as when it expired before the tap.
 */
export type WrittenOutcome =
  | ({ readonly kind: "unfrozen" } & CardActionFacts["unfreeze"])
  | {
      readonly kind: "orderActive";
      readonly order: CardAction<"autoOrder">;
      readonly isPaper: boolean;
    }
  | { readonly kind: "orderUnstarted"; readonly why: "expired" | "cancelled" };

/**
 * What followed a confirmation that the receipt shows: a paper fill, a live outcome, or what an
 * intent with nothing to send took effect as.
 */
export type ReceiptAfter =
  | { readonly kind: "paper"; readonly fill: ReceiptFill }
  | LiveOutcome
  | WrittenOutcome;

const text = (value: string): CardValue => ({ type: "text", text: value });

// The `{explorerLink}` of a receipt: the explorer page whole, or `receipt.tx` with the hash.
function txValue(tx: ReceiptTx): CardValue {
  return "explorerLink" in tx
    ? text(tx.explorerLink)
    : { type: "line", line: { key: "receipt.tx", values: { txHash: text(tx.hash) } } };
}
const choice = (value: string): CardValue => ({ type: "choice", choice: value });

function launchedLine(outcome: AfterOf<"launched">): CardLine {
  const token: CardValue = { type: "asset", asset: outcome.token };
  const explorerLink = txValue(outcome.tx);
  return outcome.fill === undefined
    ? { key: "receipt.launchedAlone", values: { token, explorerLink } }
    : {
        key: "receipt.launched",
        values: { token, result: receiptResult(outcome.fill), explorerLink },
      };
}

// The receipt of what followed a confirmation: the paper fill, or how the live intent ended.
const reasonLine = (reason: IntentReason): CardValue => ({
  type: "line",
  line: { key: `reason.${reason}`, values: {} },
});

/** What follows a confirmation, by its kind. */
type AfterOf<K extends ReceiptAfter["kind"]> = Extract<ReceiptAfter, { readonly kind: K }>;

// The receipt line of each kind of what followed a confirmation.
const afterLines: { readonly [K in ReceiptAfter["kind"]]: (after: AfterOf<K>) => CardLine } = {
  paper: (after) => paperFillLine(after.fill),
  filled: (after) => ({
    key: "receipt.filled",
    values: { result: receiptResult(after.fill), explorerLink: txValue(after.tx) },
  }),
  launched: (after) => launchedLine(after),
  landed: (after) => ({
    key: "receipt.landed",
    values: { explorerLink: txValue(after.tx) },
  }),
  failed: (after) => ({
    key: "receipt.failed",
    values: { reason: reasonLine(after.reason), explorerLink: txValue(after.tx) },
  }),
  done: () => ({ key: "receipt.done", values: {} }),
  refused: (after) => ({ key: "receipt.refused", values: { reason: reasonLine(after.reason) } }),
  unsent: () => ({ key: "receipt.unsent", values: {} }),
  unknown: () => ({ key: "receipt.unknown", values: {} }),
  unfrozen: (after) =>
    after.scope === "agent"
      ? { key: "receipt.unfrozenAgent", values: { agent: text(after.agent) } }
      : {
          key: "receipt.unfrozenAll",
          values: { count: { type: "count", count: after.agentCount } },
        },
  orderActive: ({ order, isPaper }) => ({
    key: "receipt.orderActive",
    values: {
      mode: choice(isPaper ? "paper" : "live"),
      ...orderTermsOf(order),
      expiry: { type: "dateTime", atMs: order.expiresAtMs },
    },
  }),
  orderUnstarted: ({ why }) => ({ key: "receipt.orderUnstarted", values: { why: choice(why) } }),
};

function afterLine<K extends ReceiptAfter["kind"]>(after: AfterOf<K>): CardLine {
  const draw: (after: AfterOf<K>) => CardLine = afterLines[after.kind];
  return draw(after);
}

/** The receipt of a paper fill, flagged as paper. */
export function paperFillLine(fill: ReceiptFill): CardLine {
  return { key: "receipt.paper", values: { result: receiptResult(fill) } };
}

/**
 * The receipt line a card becomes when it closes (spec 4, section 3.5). A confirmed intent passes
 * what followed: a paper intent its paper fill, flagged as paper, a live intent how it ended on
 * chain, once it did, and an intent with nothing to send what it took effect as; until then a
 * confirmed card says it is sending.
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
