import { useEffect, useState } from "react";
import { useText } from "../i18n/console-text";

// The timer counts whole seconds; it redraws a little more often so it never skips one.
const tickMs = 250;
// Under this many seconds the time left shows in the warning color.
const lateSeconds = 10;

/** The browser's time now, read again every quarter second while the component is mounted. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, []);
  return now;
}

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

/** The seconds left on a card that expires at `expiresAt`, by the browser's clock. */
export function useSecondsLeft(expiresAt: number | undefined): number | undefined {
  const now = useNow();
  return expiresAt === undefined ? undefined : secondsLeft(expiresAt, now);
}
