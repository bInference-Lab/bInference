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

/** A request's body as the port sends it: JSON text, or a form's bytes with its boundary. */
type SentBody =
  | { readonly body: string }
  | { readonly bodyBytes: Uint8Array; readonly contentType: string };

// JSON text as it is; a multipart form, as an image edit sends, encoded once into its bytes and the
// content type that names its boundary.
async function bodyOf(init: RequestInit | undefined): Promise<SentBody> {
  const body = init?.body;
  if (typeof body === "string") {
    return { body };
  }
  if (!(body instanceof FormData)) {
    throw refused("its body is neither JSON text nor a form");
  }
  const encoded = new Response(body);
  const contentType = encoded.headers.get("content-type") ?? "";
  return { bodyBytes: new Uint8Array(await encoded.arrayBuffer()), contentType };
}

// The provider's model lists, the only GETs a model client may send: the gateway's image models
// say which fields each takes (decision 0398).
function isModelList(url: string, prefix: string): boolean {
  return url === `${prefix}models` || url === `${prefix}images/models`;
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
 * the provider's base URL, and a GET of its model lists with no body, with a JSON text body or a
 * multipart form and the client's signal,
 * carrying only the
 * client's `accept` and `content-type` and the headers the transport sets itself. Anything else is
 * refused with `runtime.model_request_refused` before it leaves. The answer streams as it arrives.
 */
export function createModelFetch(options: ModelFetchOptions): ModelFetch {
  const prefix = prefixOf(options.baseUrl);
  return async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = checkedUrl(input, prefix);
    const signal = signalOf(init);
    if (method === "GET" && isModelList(url, prefix)) {
      const headers = headersOf(init, options);
      const answer = await options.http.open({ method: "GET", url, headers, signal });
      return new Response(ReadableStream.from(answer.body), {
        status: answer.status,
        headers: answer.headers,
      });
    }
    if (method !== "POST") {
      throw refused("only POST requests, and a GET of the model list, are sent");
    }
    const sent = await bodyOf(init);
    const headers = headersOf(init, options);
    const answer = await options.http.open(
      "body" in sent
        ? { method: "POST", url, headers, body: sent.body, signal }
        : {
            method: "POST",
            url,
            headers: { ...headers, "content-type": sent.contentType },
            bodyBytes: sent.bodyBytes,
            signal,
          },
    );
    const body = emptyStatuses.has(answer.status) ? null : ReadableStream.from(answer.body);
    return new Response(body, { status: answer.status, headers: answer.headers });
  };
}
