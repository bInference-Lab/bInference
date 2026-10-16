import type { IntentView } from "@binference/protocol";
import { usePendingIntents } from "../cards/use-pending-intents";
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

/** The cards that wait for the owner, oldest first, each with Confirm and Cancel. */
export function ConfirmationsScreen(): React.JSX.Element {
  const text = useText();
  const pending = usePendingIntents();
  const intents = pending.data;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.confirmations.title")}</h1>
      <PushToggle />
      {intents === undefined ? (
        <ScreenState error={pending.error} />
      ) : (
        <PendingCards intents={intents} />
      )}
    </section>
  );
}
