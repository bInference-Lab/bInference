import { BinferenceError, type HttpRequest } from "@binference/core";
import type { StreamedAnswer } from "../contracts/streaming-http-contract.js";
import type { StreamingHttp } from "../providers/ports.js";

/** One recorded answer: a server's status, headers and body pieces, and whether it then hangs. */
export interface RecordedAnswer extends StreamedAnswer {
  /** After its pieces, the body waits until the request's signal aborts, as a stalled stream. */
  readonly hang?: boolean;
}

/** A {@link StreamingHttp} that plays recorded answers in order and keeps each request. */
export interface RecordedHttp extends StreamingHttp {
  /** The requests it received, oldest first. */
  readonly requests: readonly HttpRequest[];
}

const encoder = new TextEncoder();

async function abortOf(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.throwIfAborted();
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

async function* bodyOf(
  answer: RecordedAnswer,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array, void, undefined> {
  for (const chunk of answer.chunks) {
    signal.throwIfAborted();
    yield encoder.encode(chunk);
  }
  if (answer.hang === true) {
    await abortOf(signal);
  }
}

/**
 * Creates a {@link RecordedHttp} that answers the n-th request with the n-th answer, its body
 * streamed piece by piece and cut by the request's signal. A request past the last answer rejects
 * with a retryable `http.unreachable`, as an adapter does when no answer comes.
 */
export function createRecordedHttp(answers: readonly RecordedAnswer[]): RecordedHttp {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async open(request) {
      request.signal.throwIfAborted();
      const answer = answers[requests.length];
      requests.push(request);
      if (answer === undefined) {
        throw new BinferenceError({
          code: "http.unreachable",
          message: "No recorded answer is left.",
          retryable: true,
          details: { method: request.method },
        });
      }
      return {
        status: answer.status,
        headers: answer.headers,
        body: bodyOf(answer, request.signal),
      };
    },
  };
}
