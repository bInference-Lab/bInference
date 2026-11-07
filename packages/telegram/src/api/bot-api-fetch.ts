import { BinferenceError, fetchInputUrl, type Http, type HttpResponse } from "@binference/core";

/** The `fetch` grammY calls: its own types name an untyped package, so it is spelled out here. */
export type BotApiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** One Bot API request as binference's outbound HTTP takes it, without its signal. */
export interface BotApiRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  /** Only the content type: the adapter keeps its own connections and names itself. */
  readonly headers: Readonly<Record<string, string>>;
  /** grammY's JSON payload. */
  readonly body?: string;
  /** A file upload as grammY encodes it, `multipart/form-data`, in place of `body`. */
  readonly bodyBytes?: Uint8Array;
}

/** What came back for one Bot API request: its status, its content type and its text. */
export interface BotApiAnswer {
  readonly status: number;
  readonly contentType?: string;
  readonly body: string;
}

// Statuses whose answer carries no body, which `Response` refuses one for.
const emptyStatuses: ReadonlySet<number> = new Set([101, 204, 205, 304]);

function unsupported(what: string): BinferenceError {
  return new BinferenceError({
    code: "telegram.request_unsupported",
    message: `binference sends Telegram no ${what}.`,
  });
}

function methodOf(init: RequestInit | undefined): BotApiRequest["method"] {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    throw unsupported(`${method} request`);
  }
  return method;
}

// A request's method, URL and content type, the only header the adapter passes on.
function requestHead(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Omit<BotApiRequest, "body" | "bodyBytes"> {
  const contentType = new Headers(init?.headers).get("content-type");
  const headers = contentType === null ? {} : { "content-type": contentType };
  return { method: methodOf(init), url: fetchInputUrl(input), headers };
}

// The largest upload binference sends: Telegram's own limit for a photo.
const mostUploadBytes = 10 * 1024 * 1024;

/**
 * Reads one of grammY's requests: its method, URL, content type and JSON text. grammY's
 * `connection` header stays behind, since the adapter owns its connections. A file upload, whose
 * body is a stream, is `telegram.request_unsupported` here; `createBotApiFetch` reads one whole.
 */
export function botApiRequestOf(
  input: string | URL | Request,
  init: RequestInit | undefined,
): BotApiRequest {
  const body = init?.body ?? undefined;
  if (body !== undefined && typeof body !== "string") {
    throw unsupported("file uploads");
  }
  return { ...requestHead(input, init), ...(body === undefined ? {} : { body }) };
}

/*
 * Reads one of grammY's requests as `botApiRequestOf` does, and a file upload too: grammY's
 * `multipart/form-data` stream, read whole into bytes. An upload over Telegram's 10 MB photo limit
 * is `telegram.request_unsupported`.
 */
async function readBotApiRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<BotApiRequest> {
  const body = init?.body ?? undefined;
  if (body === undefined || typeof body === "string") {
    return botApiRequestOf(input, init);
  }
  const bytes = new Uint8Array(await new Response(body).arrayBuffer());
  if (bytes.length > mostUploadBytes) {
    throw unsupported("upload over 10 MB");
  }
  return { ...requestHead(input, init), bodyBytes: bytes };
}

/** The answer of the Http port as grammY reads it: its status and its text, read as JSON. */
export function botApiAnswerOf(answer: HttpResponse): BotApiAnswer {
  const contentType = answer.headers["content-type"];
  return {
    status: answer.status,
    ...(contentType === undefined ? {} : { contentType }),
    body: answer.body,
  };
}

/**
 * grammY's signal as Node's. grammY makes its signals with an old polyfill that has no `reason`
 * and no `throwIfAborted`, which binference's outbound HTTP calls; only `aborted` and the `abort`
 * event are read here.
 */
export function nodeSignalOf(signal: RequestInit["signal"]): AbortSignal {
  const controller = new AbortController();
  if (signal?.aborted === true) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

/** A `Response` for grammY over one answer. */
export function botApiResponseOf(answer: BotApiAnswer): Response {
  const headers = answer.contentType === undefined ? {} : { "content-type": answer.contentType };
  const body = emptyStatuses.has(answer.status) ? null : answer.body;
  return new Response(body, { status: answer.status, headers });
}

/**
 * grammY's `fetch` over the Http port, so every Bot API call goes out through binference's one
 * outbound HTTP adapter, which names binference in its user agent. A call with no answer rejects
 * with the adapter's `http.unreachable`, whose cause names the socket's code, so the Bot API's
 * error mapping still tells a request that never left from one that may have reached Telegram.
 */
export function createBotApiFetch(http: Http): BotApiFetch {
  return async (input, init) => {
    const request = await readBotApiRequest(input, init);
    // grammY gives every call a signal of its own, bounded by its timeout.
    const signal = nodeSignalOf(init?.signal);
    return botApiResponseOf(botApiAnswerOf(await http.request({ ...request, signal })));
  };
}
