import { cardLineText } from "@binference/i18n";
import {
  type IntentState,
  intentStateSchema,
  type ProtocolId,
  protocolIdSchema,
  type PushFrame,
} from "@binference/protocol";
import { callOptions, type ChatContext } from "./chat-context.js";

/** The receipts the chat prints as the agent's bridges move. */
export interface ChatReceipts {
  /** Reads an intent an `intent/changed` push names, and prints its bridge's receipt once. */
  pushed(push: PushFrame): Promise<void>;
}

// The moves after which a bridge's receipt says more: its final deposit, then its delivery or
// refund (spec 6, section 8).
const bridgeMoves: ReadonlySet<IntentState> = new Set(["finalized", "reconciled"]);

// The most receipts the chat remembers printing; past that it forgets them all, and a push that
// repeats an older move prints its line again.
const mostPrinted = 200;

function isBridgeMove(data: object): boolean {
  const state = "state" in data ? intentStateSchema.safeParse(data.state) : undefined;
  return state?.success === true && bridgeMoves.has(state.data);
}

// The intent a push of a bridge's move names; none for any other push.
function movedIntent(push: PushFrame): ProtocolId<"intent"> | undefined {
  const { data } = push;
  const isObject = typeof data === "object" && data !== null;
  if (push.kind !== "intent/changed" || !isObject || !isBridgeMove(data)) {
    return undefined;
  }
  const intent = "intent" in data ? protocolIdSchema("intent").safeParse(data.intent) : undefined;
  return intent?.success === true ? intent.data : undefined;
}

/**
 * Prints the line a bridge of the chat's agent ends its card with as it moves (spec 4, section
 * 3.9): on its way once its deposit is final, then delivered or paid back, as `intent/get` gives
 * it, each line once. A read that fails prints nothing.
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
      const line = view?.agent === context.agent ? view.bridgeReceipt : undefined;
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
