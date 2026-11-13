import type { IntentView } from "@binference/protocol";
import { ClosedCards } from "../screens/confirmations-screen";
import { PendingCard } from "../screens/pending-card";
import { useCardCopies } from "./use-card-copies";

/**
 * The cards `matches` picks, such as one agent's, as the confirmations screen draws them; the same
 * query keeps both up to date: those that wait, each with Confirm, Cancel and its time left, under
 * `label`, then those that closed since the page opened, each with its receipt in place of its
 * buttons.
 */
export function CardGroup(props: {
  readonly matches: (intent: IntentView) => boolean;
  readonly label: string;
}): React.JSX.Element {
  const { matches, label } = props;
  const copies = useCardCopies();
  const waiting = (copies.waiting ?? []).filter(matches);
  return (
    <>
      {waiting.length === 0 ? null : (
        <section aria-label={label} className="flex flex-col gap-3">
          {waiting.map((intent) => (
            <PendingCard key={intent.intent} intent={intent} />
          ))}
        </section>
      )}
      <ClosedCards intents={copies.closed.filter(matches)} />
    </>
  );
}
