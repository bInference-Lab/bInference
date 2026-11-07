import { chartTextLines } from "@binference/chart";
import { displayOutsideText } from "@binference/i18n";
import type { ChatPush } from "@binference/protocol";
import type { RichLine } from "@binference/rich-text";
import { type DepositShowing, shownChat } from "./deposit-photos.js";

/** A `chat/chart` push: the chart the agent showed the owner. */
export type ChartPush = Extract<ChatPush, { readonly kind: "chat/chart" }>;

const text = { kind: "text" } as const;

/*
 * A chart as Telegram shows it (decision 0387): Telegram draws no chart, so its text, the title
 * line in bold. Every line is the agent's words, so each goes through `displayOutsideText`.
 */
function chartLinesOf(push: ChartPush): readonly RichLine[] {
  return chartTextLines(push.chart).map((line, index) => {
    const shown = displayOutsideText(line, Number.POSITIVE_INFINITY);
    const marks = index === 0 ? [{ kind: "bold" as const }] : [];
    return { block: text, runs: [{ text: shown, marks }] };
  });
}

/** Shows a `chat/chart` push in the turn's chat, or the owner's, as an answer given. */
export async function showChart(
  replies: Pick<DepositShowing, "bot" | "showing" | "owner">,
  push: ChartPush,
  signal: AbortSignal,
): Promise<void> {
  const chatId = await shownChat(replies);
  if (chatId !== undefined) {
    await replies.bot.sayRich({ chatId }, chartLinesOf(push), { signal });
  }
}
