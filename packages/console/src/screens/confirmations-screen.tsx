import type { IntentView } from "@binference/protocol";
import { useId } from "react";
import { useCardCopies } from "../cards/use-card-copies";
import { useText } from "../i18n/console-text";
import { PushToggle } from "../push/push-toggle";
import { PendingCard } from "./pending-card";
import { ScreenState } from "./screen-state";

function PendingCards(props: { readonly intents: readonly IntentView[] }): React.JSX.Element {
  const text = useText();
  if (props.intents.length === 0) {
    return <p className="text-sm text-muted-foreground">{text("console.confirmations.empty")}</p>;
  }
  return (
    <>
      {props.intents.map((intent) => (
        <PendingCard key={intent.intent} intent={intent} />
      ))}
    </>
  );
}

/**
 * The cards that closed since the page opened, newest first, each with the line its copies end
 * with in place of its buttons; nothing when none did.
 */
export function ClosedCards(props: {
  readonly intents: readonly IntentView[];
}): React.JSX.Element | null {
  const text = useText();
  const id = useId();
  if (props.intents.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-sm text-muted-foreground">
        {text("console.confirmations.closed")}
      </h2>
      {props.intents.map((intent) => (
        <PendingCard key={intent.intent} intent={intent} isClosed />
      ))}
    </section>
  );
}

/**
 * The cards that wait for the owner, oldest first, each with Confirm and Cancel, then those that
 * closed since the page opened, each with its receipt.
 */
export function ConfirmationsScreen(): React.JSX.Element {
  const text = useText();
  const { waiting, closed, error } = useCardCopies();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.confirmations.title")}</h1>
      <PushToggle />
      {waiting === undefined ? <ScreenState error={error} /> : <PendingCards intents={waiting} />}
      <ClosedCards intents={closed} />
    </section>
  );
}
