/** The message of a unit a span is told in. */
type UnitKey = "pnl.days" | "pnl.hours" | "pnl.minutes";

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

// The units a span is told in, the largest first.
const units: readonly { readonly key: UnitKey; readonly unitMs: number }[] = [
  { key: "pnl.days", unitMs: dayMs },
  { key: "pnl.hours", unitMs: hourMs },
  { key: "pnl.minutes", unitMs: minuteMs },
];

/** A span as the owner reads it: the message of its unit, and how many whole units it lasted. */
export interface WholeUnits {
  readonly key: UnitKey;
  readonly count: number;
}

/**
 * A span in whole days, else whole hours, else whole minutes (spec 4, section 3), as a closed
 * position's time held and a downtime are told; `undefined` for a span under a minute.
 */
export function wholeUnitsOf(spanMs: number): WholeUnits | undefined {
  const unit = units.find(({ unitMs }) => spanMs >= unitMs);
  return unit === undefined
    ? undefined
    : { key: unit.key, count: Math.floor(spanMs / unit.unitMs) };
}
