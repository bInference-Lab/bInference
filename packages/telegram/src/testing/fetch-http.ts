import {
  BinferenceError,
  type DownloadRequest,
  type Http,
  type HttpDownload,
} from "@binference/core";
import type { BotApiFetch } from "../api/bot-api-fetch.js";

function unreachable(cause: ErrorOptions["cause"]): BinferenceError {
  return new BinferenceError({
    code: "http.unreachable",
    message: "No answer came from the server.",
    retryable: true,
    cause,
  });
}

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
        throw unreachable(error);
      }
    },
  };
}

async function answerOf(fetch: BotApiFetch, request: DownloadRequest): Promise<Response> {
  try {
    return await fetch(request.url, { method: "GET", signal: request.signal });
  } catch (error) {
    request.signal.throwIfAborted();
    throw unreachable(error);
  }
}

/**
 * The HttpDownload port over a `fetch`, answering as binference's outbound HTTP does: the bytes as
 * they came, an answer over `maxBytes` as `http.answer_too_large`, and a download that got no
 * answer as a retryable `http.unreachable`.
 */
export function downloadOverFetch(fetch: BotApiFetch): HttpDownload {
  return {
    download: async (request) => {
      request.signal.throwIfAborted();
      const response = await answerOf(fetch, request);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > request.maxBytes) {
        throw new BinferenceError({
          code: "http.answer_too_large",
          message: `The answer is larger than ${String(request.maxBytes)} bytes.`,
        });
      }
      const contentType = response.headers.get("content-type");
      const headers = contentType === null ? {} : { "content-type": contentType };
      return { status: response.status, headers, bytes };
    },
  };
}
