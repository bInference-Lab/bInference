import type { Http } from "@binference/core";
import type { StreamingHttp } from "./ports.js";

async function* bytesOf(text: string): AsyncGenerator<Uint8Array, void, undefined> {
  yield await Promise.resolve(new TextEncoder().encode(text));
}

/**
 * A {@link StreamingHttp} over an {@link Http} that answers whole: the body arrives as one piece
 * once the whole answer is in. For a call that reads no stream, such as the model check, through
 * the outbound HTTP of the process it runs in. A request whose signal aborted rejects with the
 * signal's reason before it is sent.
 */
export function createBufferedHttp(http: Http): StreamingHttp {
  return {
    async open(request) {
      request.signal.throwIfAborted();
      const answer = await http.request(request);
      return { status: answer.status, headers: answer.headers, body: bytesOf(answer.body) };
    },
  };
}
