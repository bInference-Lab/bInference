import type { Formatter } from "@binference/i18n";
import { displayOutsideText } from "@binference/i18n";
import type { credentialPushes } from "@binference/protocol";
import { wordsOf } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";

const shown = (text: string): string => displayOutsideText(text, Number.POSITIVE_INFINITY);

/**
 * The agent's request for a credential (decision 0388), as the terminal prints it: who asks for
 * which name, the agent's reason and the hosts proposed, then where to answer it. The terminal
 * takes no credential in the chat: what the owner types there goes to the agent as a message.
 */
export function credentialLines(
  formatter: Formatter,
  push: { readonly request: credentialPushes.CredentialRequestView; readonly agentName: string },
): readonly ScreenLine[] {
  const words = wordsOf(formatter);
  const { name, reason, allowedHosts } = push.request;
  const hosts = allowedHosts.length === 0 ? "-" : allowedHosts.join(", ");
  return [
    {
      text: words("tui.credential.header", { agent: shown(push.agentName), name }),
      tone: "yellow",
    },
    ...(reason === undefined ? [] : [{ text: shown(reason) }]),
    { text: words("tui.credential.hosts", { hosts }), tone: "dim" },
    { text: words("tui.credential.where", { name }), tone: "dim" },
  ];
}
