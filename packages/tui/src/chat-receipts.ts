import { cardLineText } from "@binference/i18n";
import {
  type IntentKind,
  type IntentState,
  intentStateSchema,
  type IntentView,
  type ProtocolId,
  protocolIdSchema,
  type PushFrame,
} from "@binference/protocol";
import { callOptions, type ChatContext } from "./chat-context.js";

/** The receipts the chat prints as the agent's intents move. */
export interface ChatReceipts {
  /** Reads an intent an `intent/changed` push names, and prints its card's receipt line once. */
  pushed(push: PushFrame): Promise<void>;
}

// The moves after which a confirmed intent's receipt says more than its answer did: a bridge's
// final deposit, then how an intent ended on chain, a bridge's delivery or refund among them
// (spec 6, section 8).
const receiptMoves: ReadonlySet<IntentState> = new Set([
  "finalized",
  "reconciled",
  "failed_onchain",
]);

// The kinds whose card took effect as it was answered, which the answer's own line says.
const writtenKinds: ReadonlySet<IntentKind> = new Set(["unfreeze", "autoOrder", "webhookRule"]);

// The receipt line worth a line of its own: not the sending line the answer already printed.
function newLineOf(view: IntentView): IntentView["receipt"] {
  const { receipt } = view;
  return receipt?.key === "receipt.confirmed" || writtenKinds.has(view.kind) ? undefined : receipt;
}

// The most receipts the chat remembers printing; past that it forgets them all, and a push that
// repeats an older move prints its line again.
const mostPrinted = 200;

function isReceiptMove(data: object): boolean {
  const state = "state" in data ? intentStateSchema.safeParse(data.state) : undefined;
  return state?.success === true && receiptMoves.has(state.data);
}

// The intent a push of a move with a receipt names; none for any other push.
function movedIntent(push: PushFrame): ProtocolId<"intent"> | undefined {
  const { data } = push;
  const isObject = typeof data === "object" && data !== null;
  if (push.kind !== "intent/changed" || !isObject || !isReceiptMove(data)) {
    return undefined;
  }
  const intent = "intent" in data ? protocolIdSchema("intent").safeParse(data.intent) : undefined;
  return intent?.success === true ? intent.data : undefined;
}

/**
 * Prints the line an intent of the chat's agent ends its card with as it moves (spec 4, section
 * 3.5; decision 0346), as `intent/get` gives it in `receipt`: a bridge on its way once its deposit
 * is final, then how an intent ended on chain with its link, a bridge delivered or paid back,
 * each line once. The sending line, and the line of a card that took effect as it was answered,
 * are the answer's own. A read that fails prints nothing.
 */
export function createChatReceipts(context: ChatContext): ChatReceipts {
  const printed = new Set<string>();
  return {
    async pushed(push) {
      const intent = movedIntent(push);
      if (intent === undefined) {
        return;
      }
      const read = context.client.call("intent/get", { intent }, callOptions(context));
      const view = await read.catch(() => undefined);
      const line = view?.agent === context.agent ? newLineOf(view) : undefined;
      const seen = `${intent} ${line?.key ?? ""}`;
      if (view === undefined || line === undefined || printed.has(seen)) {
        return;
      }
      if (printed.size >= mostPrinted) {
        printed.clear();
      }
      printed.add(seen);
      context.print([
        { text: cardLineText(line, { formatter: context.formatter, assets: view.assets }) },
      ]);
    },
  };
}
