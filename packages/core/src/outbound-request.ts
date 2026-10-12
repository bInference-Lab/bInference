import { BinferenceError } from "./errors/binference-error.js";
import type { HttpMethod, HttpRequest } from "./http-exchange.js";

// What every outbound HTTP adapter does the same way, whatever library sends the bytes: the
// request it sends, the headers it answers with, and what it rejects with.

/** A request as an adapter hands it to its HTTP library. */
export interface OutboundInit {
  readonly method: HttpMethod;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | Readonly<Uint8Array>;
  readonly signal: AbortSignal;
}

function originOf(request: HttpRequest): string {
  return new URL(request.url).origin;
}

// Header names match whatever their case, so a caller's own user agent gives way to binference's.
function headersFor(request: HttpRequest, userAgent: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (name.toLowerCase() !== "user-agent") {
      headers[name] = value;
    }
  }
  return { ...headers, "user-agent": userAgent };
}

// A request carries text or bytes, never both: two bodies are a fault of the caller.
function bodyOf(request: HttpRequest): string | Readonly<Uint8Array> | undefined {
  if (request.body !== undefined && request.bodyBytes !== undefined) {
    throw new BinferenceError({
      code: "http.two_bodies",
      message: "A request sets body or bodyBytes, never both.",
      details: { method: request.method, origin: originOf(request) },
    });
  }
  return request.bodyBytes ?? request.body;
}

/**
 * What an adapter sends for a request: its method, its headers with `user-agent` set to the
 * adapter's in place of any the caller set, its body, and its signal. A request that sets both
 * `body` and `bodyBytes` throws `http.two_bodies`.
 */
export function outboundInit(request: HttpRequest, userAgent: string): OutboundInit {
  const body = bodyOf(request);
  return {
    method: request.method,
    headers: headersFor(request, userAgent),
    ...(body === undefined ? {} : { body }),
    signal: request.signal,
  };
}

/** An answer's headers as the Http ports give them: names lowercase, repeated values joined. */
export function answerHeaders(
  raw: Readonly<Record<string, string | readonly string[] | undefined>>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value !== undefined) {
      headers[name.toLowerCase()] = typeof value === "string" ? value : value.join(", ");
    }
  }
  return headers;
}

/**
 * Throws what an adapter rejects with when a request failed: the signal's reason when it aborted,
 * a `BinferenceError` as it is, and anything else as a retryable `http.unreachable` that names
 * only the method and the origin, never the path, a header or a body.
 */
export function throwOutboundFailure(request: HttpRequest, cause: ErrorOptions["cause"]): never {
  if (request.signal.aborted) {
    throw request.signal.reason;
  }
  if (cause instanceof BinferenceError) {
    throw cause;
  }
  throw new BinferenceError({
    code: "http.unreachable",
    message: "No answer came from the server.",
    retryable: true,
    cause,
    details: { method: request.method, origin: originOf(request) },
  });
}
