import type { Result } from "@binference/core";

/** The value of a success, so a test reads it without a conditional; a failure throws. */
export function successOf<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}
