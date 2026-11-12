import { BinferenceError } from "../errors/binference-error.js";

// U+0000, which Postgres stores in no text and no jsonb, and SQLite stores in both (decision 0416).
const nul = "\u0000";

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Whether any string or object key in `value` holds U+0000, however deep: what no store writes
 * (decision 0416). Bytes, numbers and every other value hold none.
 */
export function holdsNul(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes(nul);
  }
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) {
    return false;
  }
  if (isList(value)) {
    return value.some(holdsNul);
  }
  return Object.entries(value).some(
    (field: readonly [string, unknown]) => field[0].includes(nul) || holdsNul(field[1]),
  );
}

/**
 * Refuses a store call whose input holds U+0000 anywhere with `store.nul_text`, before anything is
 * written (decision 0416), so a write that one database would take fails alike on both. `what`
 * names the call for the message.
 */
export function refuseNulText(input: unknown, what: string): void {
  if (holdsNul(input)) {
    throw new BinferenceError({
      code: "store.nul_text",
      message: `${what} holds U+0000, which no store keeps; the text should have come in with U+FFFD in its place.`,
      details: { task: what },
    });
  }
}
