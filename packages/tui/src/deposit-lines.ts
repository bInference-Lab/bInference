import { displayOutsideText, type Formatter } from "@binference/i18n";
import type { ChatPush } from "@binference/protocol";
import { wordsOf } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";

// The most characters of a wallet's label a line shows.
const labelLength = 40;

/**
 * The wallets a `chat/deposit` push shows (decision 0380), as the terminal prints them: each
 * wallet's label and chain, its address as the engine read it from custody, the network to send on,
 * and a warning while the agent trades on paper or is frozen. The QR codes show in Telegram.
 */
export function depositLines(
  formatter: Formatter,
  push: Extract<ChatPush, { readonly kind: "chat/deposit" }>,
): readonly ScreenLine[] {
  const words = wordsOf(formatter);
  const warnings: readonly ScreenLine[] = [
    ...(push.mode === "paper"
      ? [{ text: words("cmd.wallet.paperFunds"), tone: "dim" } as const]
      : []),
    ...(push.frozen ? [{ text: words("cmd.wallet.frozenFunds"), tone: "dim" } as const] : []),
  ];
  return push.wallets.flatMap((view) => {
    const at = view.address.lastIndexOf(":");
    const chain = view.chainName ?? view.address.slice(0, at);
    return [
      { text: `${displayOutsideText(view.label, labelLength)} · ${chain}` },
      { text: `  ${view.address.slice(at + 1)}` },
      { text: words("cmd.wallet.network", { chain }), tone: "dim" } as const,
      ...warnings,
    ];
  });
}
