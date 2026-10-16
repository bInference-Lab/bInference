import { useNow } from "../app/use-now";
import { useText } from "../i18n/console-text";

// Under this many seconds the time left shows in the warning color.
const lateSeconds = 10;

// The whole seconds a card has left at `now`; 0 once it expired.
function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1_000));
}

/**
 * How long a card has left before it expires (a card lasts 60 seconds), counted down each second,
 * then that it expired. Screen readers read it on request, not at each tick.
 */
export function CardTimer(props: { readonly seconds: number }): React.JSX.Element {
  const text = useText();
  const { seconds } = props;
  const tone = seconds <= lateSeconds ? "text-destructive" : "text-muted-foreground";
  return (
    <span role="timer" className={`ml-auto text-xs tabular-nums ${tone}`}>
      {seconds === 0 ? text("console.cards.expired") : text("console.cards.timeLeft", { seconds })}
    </span>
  );
}

/** When a card expires, and how long it lasts from when it opened. */
export interface CardTimes {
  readonly expiresAt: number;
  readonly lifetimeMs: number;
}

/**
 * The seconds left on a card by the browser's clock, never more than the card lasts: a browser
 * whose clock runs behind the engine's shows the card's whole time rather than more.
 */
export function useSecondsLeft(times: CardTimes | undefined): number | undefined {
  const now = useNow();
  if (times === undefined) {
    return undefined;
  }
  const most = Math.ceil(times.lifetimeMs / 1_000);
  return Math.min(secondsLeft(times.expiresAt, now), most);
}
