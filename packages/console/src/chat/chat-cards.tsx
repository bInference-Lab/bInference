import type { ProtocolId } from "@binference/protocol";
import { useCardCopies } from "../cards/use-card-copies";
import { useText } from "../i18n/console-text";
import { ClosedCards } from "../screens/confirmations-screen";
import { PendingCard } from "../screens/pending-card";

/**
 * The agent's cards inline under the chat, as the confirmations screen draws them; the same query
 * keeps both up to date: those that wait, each with Confirm, Cancel and its time left, then those
 * that closed since the chat opened, each with its receipt in place of its buttons.
 */
export function ChatCards(props: {
  readonly agent: ProtocolId<"agent">;
}): React.JSX.Element | null {
  const text = useText();
  const copies = useCardCopies();
  const isAgent = (intent: { readonly agent: ProtocolId<"agent"> }) => intent.agent === props.agent;
  const waiting = (copies.waiting ?? []).filter(isAgent);
  const closed = copies.closed.filter(isAgent);
  return (
    <>
      {waiting.length === 0 ? null : (
        <section aria-label={text("console.chat.cards")} className="flex flex-col gap-3">
          {waiting.map((intent) => (
            <PendingCard key={intent.intent} intent={intent} />
          ))}
        </section>
      )}
      <ClosedCards intents={closed} />
    </>
  );
}
