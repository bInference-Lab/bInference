import type { CardLine } from "../confirmations/card-line.js";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { sendQuoteDocument } from "../intents/send-quote.js";

const text = (value: string) => ({ type: "text", text: value }) as const;

/**
 * What the words of an intent's reason may name (spec 4, section 6), from its stored quote: the
 * intent's wallet, a send by name's name (decision 0308) and a bridge's destination chain as the
 * registry names it (decision 0319). A reason's message uses the values it names and leaves the
 * others, so a surface fills every reason of the intent with these.
 */
export function reasonValuesOf(
  record: Pick<IntentRecord, "kind" | "quote" | "walletId">,
): CardLine["values"] {
  const { kind, quote, walletId } = record;
  const wallet = { wallet: text(walletId) };
  if (quote === undefined) {
    return wallet;
  }
  if (kind === "bridge") {
    return { ...wallet, chain: text(bridgeQuoteDocument.decode(quote).chainName) };
  }
  const name = kind === "send" ? sendQuoteDocument.decode(quote).name?.name : undefined;
  return name === undefined ? wallet : { ...wallet, name: text(name) };
}
