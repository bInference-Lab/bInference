/**
 * How a step of a plugin install went: its value, or a failure that carries more than a code,
 * such as the registry's wait before a retry. A failure named by a code alone is a `Result`.
 */
export type Outcome<T, F> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: F };

/** A failed step. */
export function failed<F>(failure: F): { readonly ok: false; readonly failure: F } {
  return { ok: false, failure };
}
