// Every number JSON can hold: an optional minus, an integer, a fraction and an exponent.
const jsonNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Whether a text is a number as JSON writes it, such as `753.55` or `1e-7`. */
export function isJsonNumber(text: string): boolean {
  return jsonNumber.test(text);
}

/**
 * Parses a data service's JSON answer with every number kept as the text the answer wrote, so no
 * figure passes through a floating-point number: `753.55` comes back as the string `"753.55"`.
 * Text that is not JSON is undefined, never a throw. The result goes through a zod schema next.
 */
export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text, (_key, value: unknown, context?: { readonly source?: string }) =>
      typeof value === "number" ? (context?.source ?? String(value)) : value,
    );
  } catch {
    return undefined;
  }
}
