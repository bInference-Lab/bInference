import { BinferenceError, fetchInputUrl } from "@binference/core";
import type { StreamingHttp } from "./ports.js";

/** The `fetch` an official model client calls. */
export type ModelFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Where a model client's requests may go, and what they may carry. */
export interface ModelFetchOptions {
  readonly http: StreamingHttp;
  /** The provider's base URL: a request to any other address is refused. */
  readonly baseUrl: string;
  /**
   * The headers the transport sets on every request itself, such as the provider's key and its
   * API version, in lowercase; they replace any header of the same name the client gave.
   */
  readonly headers: Readonly<Record<string, string>>;
}

// The only headers a model request takes from its client. The client's own platform headers (its
// OS, its runtime, its version), its key, any header an environment variable adds, and the
// organization and project headers stay behind; the adapter names binference in the user agent.
const passedHeaders = ["accept", "content-type"] as const;

// Statuses whose answer carries no body, which `Response` refuses one for.
const emptyStatuses: ReadonlySet<number> = new Set([101, 204, 205, 304]);

function refused(reason: string): BinferenceError {
  return new BinferenceError({
    code: "runtime.model_request_refused",
    message: `A model request was refused before it left: ${reason}.`,
  });
}

function headersOf(
  init: RequestInit | undefined,
  options: ModelFetchOptions,
): Record<string, string> {
  const given = new Headers(init?.headers);
  const kept = passedHeaders.flatMap((name) => {
    const value = given.get(name);
    return value === null ? [] : [[name, value] as const];
  });
  return { ...Object.fromEntries(kept), ...options.headers };
}

// The provider's base URL with one trailing slash, which every request URL starts with.
function prefixOf(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function checkedUrl(input: string | URL | Request, prefix: string): string {
  const url = fetchInputUrl(input);
  if (!url.startsWith(prefix)) {
    throw refused("its address is not under the provider's base URL");
  }
  return url;
}

function bodyOf(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string") {
    throw refused("its body is not JSON text");
  }
  return body;
}

function signalOf(init: RequestInit | undefined): AbortSignal {
  const signal = init?.signal;
  if (signal === undefined || signal === null) {
    throw refused("it has no signal");
  }
  return signal;
}

/**
 * The `fetch` a model client calls, over the {@link StreamingHttp} port: only POST requests under
 * the provider's base URL, with a JSON text body and the client's signal, carrying only the
 * client's `accept` and `content-type` and the headers the transport sets itself. Anything else is
 * refused with `runtime.model_request_refused` before it leaves. The answer streams as it arrives.
 */
export function createModelFetch(options: ModelFetchOptions): ModelFetch {
  const prefix = prefixOf(options.baseUrl);
  return async (input, init) => {
    if ((init?.method ?? "GET").toUpperCase() !== "POST") {
      throw refused("only POST requests are sent");
    }
    const answer = await options.http.open({
      method: "POST",
      url: checkedUrl(input, prefix),
      headers: headersOf(init, options),
      body: bodyOf(init),
      signal: signalOf(init),
    });
    const body = emptyStatuses.has(answer.status) ? null : ReadableStream.from(answer.body);
    return new Response(body, { status: answer.status, headers: answer.headers });
  };
}
