import type { Worker } from "node:worker_threads";
import type { Http } from "@binference/core";
import { isUnsentRequest } from "../api/bot-api-error.schema.js";
import { botApiAnswerOf } from "../api/bot-api-fetch.js";
import { type RelayCall, relayRequestOf } from "./relay-messages.schema.js";
import { fetchTimeoutMs } from "./update-fetcher.js";

/** The parent's side of the poll worker's requests. */
export interface Relay {
  /** Aborts every request under way; their answers are dropped. */
  close(): void;
}

// The worker waits for one batch at a time; past this many under way, a request is refused unsent.
const maxInFlight = 4;
// The worker's own timeout cancels a request first; this one only bounds a worker that went away.
const requestTimeoutMs = fetchTimeoutMs + 5_000;

/**
 * Sends the poll worker's Bot API requests through the parent's outbound HTTP and posts each
 * answer back, or word that none came and whether the request never left. A cancel from the
 * worker aborts its request.
 */
export function serveRelay(worker: Worker, http: Http): Relay {
  const inFlight = new Map<number, AbortController>();
  const closed = new AbortController();
  // A request the worker cancelled, or one under way at the close, is answered no more.
  const send = async (call: RelayCall, cancel: AbortSignal): Promise<void> => {
    const { method, url, headers } = call;
    const body = call.body === undefined ? {} : { body: call.body };
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const signal = AbortSignal.any([cancel, closed.signal, timeout]);
    try {
      const answer = await http.request({ method, url, headers, ...body, signal });
      const answered = { kind: "http_answer", id: call.id, answer: botApiAnswerOf(answer) };
      worker.postMessage(answered, []);
    } catch (error) {
      if (!cancel.aborted && !closed.signal.aborted) {
        const fault = { kind: "http_fault", id: call.id, isUnsent: isUnsentRequest(error) };
        worker.postMessage(fault, []);
      }
    }
  };
  worker.on("message", (value) => {
    const request = relayRequestOf(value);
    if (request?.kind === "http_cancel") {
      inFlight.get(request.id)?.abort();
      return;
    }
    if (request === undefined) {
      return;
    }
    if (inFlight.size >= maxInFlight) {
      worker.postMessage({ kind: "http_fault", id: request.id, isUnsent: true }, []);
      return;
    }
    const controller = new AbortController();
    inFlight.set(request.id, controller);
    void send(request, controller.signal).finally(() => inFlight.delete(request.id));
  });
  return { close: () => closed.abort() };
}
