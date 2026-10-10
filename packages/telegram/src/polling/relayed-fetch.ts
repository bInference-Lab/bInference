import type { MessagePort } from "node:worker_threads";
import { BinferenceError } from "@binference/core";
import {
  type BotApiFetch,
  botApiRequestOf,
  botApiResponseOf,
  nodeSignalOf,
} from "../api/bot-api-fetch.js";
import { type RelayAnswer, relayAnswerOf } from "./relay-messages.schema.js";

interface Waiter {
  readonly settle: (answer: RelayAnswer) => void;
}

// The poll loop waits for one batch at a time; the bound only catches a caller that does not.
const maxWaiting = 4;

function noAnswer({ isUnsent }: { readonly isUnsent: boolean }): BinferenceError {
  return new BinferenceError({
    code: "telegram.unreachable",
    message: "The Bot API request got no answer.",
    retryable: true,
    details: { isUnsent },
  });
}

/**
 * grammY's `fetch` inside the poll worker: each request goes to the parent, which sends it through
 * binference's outbound HTTP and posts the answer back, so the worker's requests carry the same
 * user agent and go through the same connections as the rest. A request the worker stops waiting
 * for is cancelled in the parent too. One the parent got no answer for rejects with
 * `telegram.unreachable`, which says whether the request never left.
 */
export function createRelayedFetch(port: MessagePort): BotApiFetch {
  const waiting = new Map<number, Waiter>();
  const ids = { last: 0 };
  port.on("message", (value) => {
    const answer = relayAnswerOf(value);
    if (answer !== undefined) {
      waiting.get(answer.id)?.settle(answer);
    }
  });
  return async (input, init) => {
    const request = botApiRequestOf(input, init);
    if (waiting.size >= maxWaiting) {
      throw noAnswer({ isUnsent: true });
    }
    ids.last += 1;
    const id = ids.last;
    const signal = nodeSignalOf(init?.signal);
    signal.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      const onAbort = (): void => {
        waiting.delete(id);
        port.postMessage({ kind: "http_cancel", id });
        reject(signal.reason);
      };
      waiting.set(id, {
        settle: (answer) => {
          waiting.delete(id);
          signal.removeEventListener("abort", onAbort);
          if (answer.kind === "http_answer") {
            resolve(botApiResponseOf(answer.answer));
          } else {
            reject(noAnswer(answer));
          }
        },
      });
      signal.addEventListener("abort", onAbort, { once: true });
      port.postMessage({ kind: "http", id, ...request });
    });
  };
}
