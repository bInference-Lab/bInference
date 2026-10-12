// Every number JSON can hold: an optional minus, an integer, a fraction and an exponent.
const jsonNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Whether a text is a number as JSON writes it, such as `753.55` or `1e-7`. */
export function isJsonNumber(text: string): boolean {
  return jsonNumber.test(text);
}

/**
 * Parses an answer of DEX Screener's API with every number kept as the text the answer wrote, so
 * no figure passes through a floating-point number. Text that is not JSON is undefined, never a
 * throw.
 */
export function parseAnswer(text: string): unknown {
  try {
    return JSON.parse(text, (_key, value: unknown, context?: { readonly source?: string }) =>
      typeof value === "number" ? (context?.source ?? String(value)) : value,
    );
  } catch {
    return undefined;
  }
}
