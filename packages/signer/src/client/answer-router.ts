import { BinferenceError } from "@binference/core";
import type { SignerAnswer, SignerLine } from "../requests/signer-message.schema.js";

/** Hands each answer the signer writes to the call that waits for it, by the request's id. */
export interface AnswerRouter {
  /**
   * Waits for the answer to the request with this id. Rejects with `signer.stopped` once the
   * signer has stopped, and with the signal's reason once the signal aborts.
   */
  wait(id: string, signal: AbortSignal): Promise<SignerAnswer>;
  /** Takes one line the signer wrote. */
  deliver(line: SignerLine): void;
  /** Ends every wait: the signer stopped, after writing `fault` when it named one. */
  end(fault?: string): void;
}

interface Waiter {
  readonly resolve: (answer: SignerAnswer) => void;
  readonly reject: (error: Error) => void;
}

function stopped(fault: string | undefined): BinferenceError {
  return new BinferenceError({
    code: "signer.stopped",
    message: "The signer process stopped; restart the engine to start it again.",
    details: fault === undefined ? {} : { fault },
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The call was aborted.", "AbortError");
}

// Registers one wait; the waiter takes itself out of the map however it ends.
function register(
  waiting: Map<string, Waiter>,
  wait: { readonly id: string; readonly signal: AbortSignal },
  waiter: Waiter,
): void {
  const { id, signal } = wait;
  const onAbort = (): void => {
    waiting.delete(id);
    waiter.reject(abortReason(signal));
  };
  const settle = (): void => {
    waiting.delete(id);
    signal.removeEventListener("abort", onAbort);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  waiting.set(id, {
    resolve: (answer) => {
      settle();
      waiter.resolve(answer);
    },
    reject: (error) => {
      settle();
      waiter.reject(error);
    },
  });
}

/** Creates an {@link AnswerRouter}. A late answer, for a wait that was aborted, is dropped. */
export function createAnswerRouter(): AnswerRouter {
  const waiting = new Map<string, Waiter>();
  let ended: BinferenceError | undefined;
  const end = (fault?: string): void => {
    ended ??= stopped(fault);
    const error = ended;
    [...waiting.values()].forEach((waiter) => {
      waiter.reject(error);
    });
  };
  return {
    wait: async (id, signal) =>
      new Promise((resolve, reject) => {
        if (ended !== undefined) {
          reject(ended);
        } else if (signal.aborted) {
          reject(abortReason(signal));
        } else {
          register(waiting, { id, signal }, { resolve, reject });
        }
      }),
    deliver: (line) => {
      if ("fault" in line) {
        end(line.fault);
        return;
      }
      const waiter = line.id === null ? undefined : waiting.get(line.id);
      waiter?.resolve(line);
    },
    end,
  };
}
