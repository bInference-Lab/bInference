import type { JsonValue } from "@binference/core";
import { displayOutsideText, type Formatter } from "@binference/i18n";
import { credentialPushes } from "@binference/protocol";
import type { BotCalls } from "../ingress/bot-calls.js";

/** What a credential request is sent with: the bot, the owner's chat and the words. */
export interface CredentialSending {
  readonly bot: BotCalls;
  readonly owner: () => Promise<number | undefined>;
  readonly formatter: () => Formatter;
}

// The agent's words as the owner reads them: every character a reader cannot see written out.
const outside = (text: string): string => displayOutsideText(text, Number.POSITIVE_INFINITY);

/**
 * Tells the owner of the agent's request for a credential (decision 0388): its name, the agent's
 * reason and the hosts proposed, and where to answer it, the console's masked prompt or
 * `binference credential set`. The chat never takes a credential: a reply here is a message like
 * any other. Any other push sends nothing.
 */
export async function showCredentialRequest(
  sending: CredentialSending,
  push: { readonly kind: string; readonly data: JsonValue },
  signal: AbortSignal,
): Promise<void> {
  const read = credentialPushes.credentialPushOf(push);
  if (read?.kind !== "chat/credentialRequest") {
    return;
  }
  const chatId = await sending.owner();
  if (chatId === undefined) {
    return;
  }
  const { name, reason, allowedHosts } = read.request;
  const formatter = sending.formatter();
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  const text = formatter.message("telegram.credential.request", {
    name,
    reason: reason === undefined ? "" : outside(reason),
    hosts: allowedHosts.length === 0 ? "-" : allowedHosts.join(", "),
  });
  await sending.bot.say({ chatId }, text, { signal });
}
