/** The success side of a {@link Result}. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** The failure side of a {@link Result}: an expected outcome named by a string literal. */
export interface Err<E extends string> {
  readonly ok: false;
  readonly error: E;
}

/**
 * The outcome of an operation that can fail in an expected way. Faults throw a
 * `BinferenceError` instead.
 */
export type Result<T, E extends string> = Ok<T> | Err<E>;

/** Wraps a value as a success. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps an expected failure, named by a string literal such as `"daily_cap"`. */
export function err<E extends string>(error: E): Err<E> {
  return { ok: false, error };
}
