import {
  baseUnitsOf,
  decimalText,
  type LimitField,
  type LimitUnit,
  limitUnits,
} from "@binference/i18n";
import { type LimitChanges, limitChangesSchema } from "@binference/protocol";

// Dollars are kept in micros, and a percent in basis points: hundredths of a percent.
const usdDecimals = 6;
const percentDecimals = 2;
const whole = /^[1-9]\d{0,9}$/u;

/** A limit's value as `limit/get` answers it, or absent. */
type LimitValue = LimitChanges[LimitField];

/** The unit a limit is set in, as every surface lists it. */
export function unitOf(field: LimitField): LimitUnit {
  return limitUnits.find((entry) => entry.field === field)?.unit ?? "list";
}

/**
 * A limit's value as the owner types it in the console: dollars and a percent as plain decimals
 * (`50`, `0.5`), seconds and days as whole numbers, a list joined by commas.
 */
export function inputOf(field: LimitField, value: LimitValue): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "bigint") {
    return decimalText(value, usdDecimals);
  }
  if (typeof value === "number") {
    return unitOf(field) === "bps" ? decimalText(BigInt(value), percentDecimals) : String(value);
  }
  return value.join(", ");
}

/** A limit's value as `limit/set` takes it on the wire. */
type Wire = string | number | readonly string[];

function wholeWire(typed: string): Wire | undefined {
  return whole.test(typed) ? Number(typed) : undefined;
}

function percentWire(typed: string): Wire | undefined {
  const bps = baseUnitsOf(typed.replace(/%$/u, ""), percentDecimals);
  return bps === undefined ? undefined : Number(bps);
}

// How the typed text of each unit becomes its value on the wire, which the protocol's schema
// then reads; `undefined` for text the unit cannot read.
const wireOf: Readonly<Record<LimitUnit, (typed: string) => Wire | undefined>> = {
  usd: (typed) => baseUnitsOf(typed.replace(/^\$/u, ""), usdDecimals)?.toString(),
  bps: percentWire,
  seconds: wholeWire,
  days: wholeWire,
  list: (typed) =>
    typed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
};

/**
 * The change of one limit the owner typed, checked by the protocol's own schema before anything
 * is sent; `undefined` for a value the limit does not take, such as `abc` dollars, a percent over
 * 100 or a token that is no asset reference.
 */
export function limitChangeOf(field: LimitField, typed: string): LimitChanges | undefined {
  const wire = wireOf[unitOf(field)](typed.trim());
  const parsed = limitChangesSchema.safeParse({ [field]: wire ?? null });
  return parsed.success ? parsed.data : undefined;
}
