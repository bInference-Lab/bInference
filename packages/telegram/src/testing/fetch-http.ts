import { BinferenceError, type Http } from "@binference/core";
import type { BotApiFetch } from "../api/bot-api-fetch.js";

/**
 * The Http port over a `fetch`, answering as binference's outbound HTTP does: every status as it
 * came, with its content type, and a request that got no answer as a retryable
 * `http.unreachable` whose cause is the fetch's own error.
 */
export function httpOverFetch(fetch: BotApiFetch): Http {
  return {
    request: async (request) => {
      request.signal.throwIfAborted();
      const body = request.body === undefined ? {} : { body: request.body };
      const headers = request.headers === undefined ? {} : { headers: request.headers };
      try {
        const response = await fetch(request.url, {
          method: request.method,
          ...headers,
          ...body,
          signal: request.signal,
        });
        const contentType = response.headers.get("content-type");
        return {
          status: response.status,
          headers: contentType === null ? {} : { "content-type": contentType },
          body: await response.text(),
        };
      } catch (error) {
        request.signal.throwIfAborted();
        throw new BinferenceError({
          code: "http.unreachable",
          message: "No answer came from the server.",
          retryable: true,
          cause: error,
        });
      }
    },
  };
}
