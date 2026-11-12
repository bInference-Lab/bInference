import assert from "node:assert/strict";
import { BinferenceError } from "../errors/binference-error.js";

/** Text with U+0000 inside it, which every store refuses alike (decision 0416). */
export function withNul(text: string): string {
  return `${text}\u0000${text}`;
}

/**
 * Asserts that a store call refuses its input with `store.nul_text`, the same refusal on every
 * adapter and fake (decision 0416). The caller then checks that nothing was written.
 */
export async function assertRefusesNulText<Output>(call: () => Promise<Output>): Promise<void> {
  await assert.rejects(
    call(),
    (error) => error instanceof BinferenceError && error.code === "store.nul_text",
  );
}
