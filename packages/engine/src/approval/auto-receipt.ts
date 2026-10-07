import { paperFillLine, type ReceiptFill, receiptResult } from "../confirmations/card-closing.js";
import type { CardKey, CardLine } from "../confirmations/card-line.js";
import { isFillAuthorization } from "../intents/authorization.js";
import type { IntentCommit } from "../intents/intent-change.js";
import { authorizationDocument } from "../intents/intent-documents.schema.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/**
 * How an intent the auto mode authorized settled: a paper fill, or a live trade with the explorer
 * link of its transaction.
 */
export type AutoSettlement =
  | { readonly isPaper: true; readonly fill: ReceiptFill }
  | { readonly isPaper: false; readonly fill: ReceiptFill; readonly explorerLink: string };

/**
 * The receipt of a trade the auto mode ran, which has no card to edit (spec 4, section 3.5): an
 * auto trade's receipt with what it sold and bought and its explorer link, or, for a paper trade,
 * the paper fill's receipt, since nothing went on chain.
 */
export function autoReceiptLine(settlement: AutoSettlement): CardLine {
  if (settlement.isPaper) {
    return paperFillLine(settlement.fill);
  }
  return {
    key: "receipt.auto",
    values: {
      result: receiptResult(settlement.fill),
      explorerLink: { type: "text", text: settlement.explorerLink },
    },
  };
}

function isAutoAuthorized(commit: IntentCommit): boolean {
  const { authorizedBy } = commit.intent;
  return (
    authorizedBy !== undefined && !isFillAuthorization(authorizationDocument.decode(authorizedBy))
  );
}

/**
 * The receipt notice of a move that settles an intent the auto mode authorized: into `reconciled`
 * live, or into `paper_filled` on paper. It names the intent; the surface draws the receipt with
 * {@link autoReceiptLine} from the stored intent. Any other move sends none.
 */
export function autoReceiptPushes(commit: IntentCommit): readonly EnginePush[] {
  const { intent } = commit;
  const isSettled = intent.state === "reconciled" || intent.state === "paper_filled";
  if (!isSettled || !isAutoAuthorized(commit)) {
    return [];
  }
  const key: CardKey = intent.isPaper ? "receipt.paper" : "receipt.auto";
  return [noticePush({ key, agent: intent.agentId, intent: intent.id, values: {} })];
}
