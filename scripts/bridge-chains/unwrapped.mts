/** The value of a successful result; a failed one ends the read with its error. */
export function unwrapped<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string },
): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}
