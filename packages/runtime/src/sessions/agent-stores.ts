import { BinferenceError } from "@binference/core";
import type { ChatQueueStore, SessionStore, TranscriptStore } from "@binference/store";

/**
 * The stores of `agent.sqlite` one runtime start writes with, and the writer fence it raised: every
 * write names the fence, so a runtime left over from an earlier start writes nothing.
 */
export interface AgentStores {
  readonly sessions: SessionStore;
  readonly transcript: TranscriptStore;
  readonly queue: ChatQueueStore;
  readonly fence: number;
}

/** A write `agent.sqlite` refused: a later start raised the fence, or a rule the runtime broke. */
function refusedWrite(what: string, refusal: string): BinferenceError {
  return new BinferenceError({
    code: "runtime.store_refused",
    message: `agent.sqlite refused to ${what}: ${refusal}.`,
    details: { refusal },
  });
}

/** The value of a store write, or the error that says why it was refused. */
export function written<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string },
  what: string,
): T {
  if (!result.ok) {
    throw refusedWrite(what, result.error);
  }
  return result.value;
}
