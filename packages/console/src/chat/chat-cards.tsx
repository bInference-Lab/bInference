import type { ProtocolId } from "@binference/protocol";
import { usePendingIntents } from "../cards/use-pending-intents";
import { useText } from "../i18n/console-text";
import { PendingCard } from "../screens/pending-card";

/**
 * The agent's cards that wait for the owner, inline under the chat, each with Confirm, Cancel and
 * its time left, as the confirmations screen draws them; the same query keeps both up to date.
 */
export function ChatCards(props: {
  readonly agent: ProtocolId<"agent">;
}): React.JSX.Element | null {
  const text = useText();
  const cards = (usePendingIntents().data ?? []).filter((intent) => intent.agent === props.agent);
  if (cards.length === 0) {
    return null;
  }
  return (
    <section aria-label={text("console.chat.cards")} className="flex flex-col gap-3">
      {cards.map((intent) => (
        <PendingCard key={intent.intent} intent={intent} />
      ))}
    </section>
  );
}
