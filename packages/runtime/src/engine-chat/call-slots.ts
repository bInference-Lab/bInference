import type { ProtocolClient } from "@binference/client";
import { BinferenceError, type Clock } from "@binference/core";

/** The protocol client's calls, which the runtime's link wraps. */
export type CallClient = Pick<ProtocolClient, "call">;

/**
 * The runtime's calls on its link, each counted until it settles, so a call its client had no room
 * for waits for one to free (decision 0442).
 */
export interface CallSlots extends CallClient {
  /**
   * Resolves once a call that went out through these slots settled, or a second passed, for a slot
   * a call of the client's own held; rejects with the signal's reason when it aborts.
   */
  freed(signal: AbortSignal): Promise<void>;
}

// A slot a call of the client's own holds, such as a subscribe after a reconnect, frees with no
// call of these slots settling; a waiting call looks again this often.
const lookAgainMs = 1_000;

/** Whether the client refused a call before it sent it: no room among its waiting calls. */
export function isClientBusy(error: Readonly<Error>): boolean {
  return error instanceof BinferenceError && error.code === "client.busy";
}

/** Creates the {@link CallSlots} of the client, timing each look again on the clock. */
export function createCallSlots(client: CallClient, clock: Clock): CallSlots {
  const waiting = new Set<() => void>();
  const wakeAll = (): void => {
    const woken = [...waiting];
    waiting.clear();
    woken.forEach((wake) => wake());
  };
  return {
    async call(op, args, options) {
      try {
        const result = await client.call(op, args, options);
        wakeAll();
        return result;
      } catch (error) {
        // A call the client refused `client.busy` held no slot, so its end frees none.
        if (!(error instanceof Error && isClientBusy(error))) {
          wakeAll();
        }
        throw error;
      }
    },
    async freed(signal) {
      signal.throwIfAborted();
      const looked = new AbortController();
      const wake = { run: (): void => undefined };
      const freedOne = new Promise<void>((resolve) => {
        wake.run = resolve;
        waiting.add(resolve);
      });
      const lookAgain = clock.sleep(lookAgainMs, AbortSignal.any([signal, looked.signal]));
      try {
        await Promise.race([freedOne, lookAgain]);
      } finally {
        waiting.delete(wake.run);
        looked.abort();
      }
    },
  };
}
