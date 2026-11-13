import {
  BinferenceError,
  type Clock,
  createDeadline,
  type HttpRequest,
  nestsDeeperThan,
} from "@binference/core";
import { z } from "zod";
import { jsonOfText } from "../providers/gateway-video-job.schema.js";
import type { StreamingHttp } from "../providers/ports.js";
import type { StreamedHttpResponse } from "../providers/streamed-http-response.js";
import { discardBody, readBodyStart } from "../web/read-body.js";

/** Why a request to a listed server got no good answer (decision 0430). */
export type ListedFailureReason =
  | "unreachable"
  | "too_large"
  | "bad_answer"
  | "refused"
  | "rate_limited"
  | "timed_out"
  | "busy";

/** A request to a listed server that got no good answer, as the fetch saw it. */
export interface ListedFailure {
  readonly reason: ListedFailureReason;
  /** The server's status, for an answer it gave. */
  readonly status?: number;
  /** For `rate_limited`: the seconds `Retry-After` named, when it named a number. */
  readonly retryAfterSeconds?: number;
}

/** A fetch as the MCP client's transport calls it. */
export type ListingFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** How long one request may take, by what it is for. */
interface ListingDeadlines {
  /** The handshake, the tool list and every notice. */
  readonly connectMs: number;
  /** A `tools/call`. */
  readonly callMs: number;
  /** The `DELETE` that ends a session. */
  readonly closeMs: number;
}

/** What a listing's fetch sends through, and where it says what went wrong. */
export interface ListingFetchParts {
  /** The runtime's outbound HTTP: the route in force, the owner's proxy or the guarded exit. */
  readonly http: StreamingHttp;
  /** The listing's endpoint, as the URL parser writes it: the one URL the fetch sends to. */
  readonly url: string;
  /** The most bytes one answer may hold. */
  readonly maxBytes: number;
  readonly clock: Clock;
  readonly deadlines: ListingDeadlines;
  /**
   * Hears why a request failed, before the transport sees the failure, with the tag of the call
   * it was for, from its {@link listedCallHeader}; none for a request of the connection's own.
   */
  readonly onFailure: (failure: ListedFailure, call: string | undefined) => void;
}

/** The header a call's requests carry the call's tag in: the fetch reads it, and never sends it. */
export const listedCallHeader = "x-binference-call";

// The requests one connection may have in flight: a server that makes its client send more is
// refused here.
const maxInFlight = 8;
const sentHeaders: ReadonlySet<string> = new Set(["accept", "content-type"]);
const readTypes: ReadonlySet<string> = new Set(["application/json", "text/event-stream"]);
const redirects: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

// A message of the client's that names a method: a request or a notice. One that names none is a
// reply, which binference never sends a server.
const clientMessageSchema = z.object({ method: z.string() });
// A request of the server's: a method and an id. binference advertises no capability and reads none.
const serverRequestSchema = z.object({ method: z.string(), id: z.union([z.string(), z.number()]) });
const batchSchema = z.array(z.unknown());

interface Sent {
  readonly method: "POST" | "DELETE";
  /** What the request is for: `tools/call`, any other method, or the session's end. */
  readonly timeoutMs: number;
  /** The call's tag, when a call sent it. */
  readonly call: string | undefined;
}

function failed(parts: ListingFetchParts, failure: ListedFailure, sent?: Sent): BinferenceError {
  parts.onFailure(failure, sent?.call);
  return new BinferenceError({
    code: "runtime.listed_mcp_failed",
    message: `A listed MCP server's request got no good answer: ${failure.reason}.`,
    details: {
      reason: failure.reason,
      ...(failure.status === undefined ? {} : { status: failure.status }),
    },
  });
}

// The headers the transport set that leave: the content's type, what it accepts, and the
// protocol's own `mcp-` headers. binference's HTTP names itself; no cookie or credential leaves.
function headersOf(init: RequestInit | undefined): Record<string, string> {
  const kept: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => {
    if (sentHeaders.has(name) || name.startsWith("mcp-")) {
      kept[name] = value;
    }
  });
  return kept;
}

function baseType(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

// The data of each event of a stream of server-sent events, as an event source joins it.
function eventData(text: string): readonly string[] {
  const events: string[] = [];
  let data: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === "") {
      events.push(data.join("\n"));
      data = [];
    } else if (line.startsWith("data:")) {
      data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
    }
  }
  return [...events, data.join("\n")];
}

// The JSON texts of an answer: its body whole, or a stream's events one by one.
function jsonTexts(type: string, text: string): readonly string[] {
  return type === "application/json" ? [text] : eventData(text);
}

// Whether an answer holds a request of the server's, alone or in a batch.
function holdsServerRequest(texts: readonly string[]): boolean {
  return texts.some((text) => {
    const value = jsonOfText(text);
    const batch = batchSchema.safeParse(value);
    const messages = batch.success ? batch.data : [value];
    return messages.some((message) => serverRequestSchema.safeParse(message).success);
  });
}

function retryAfterOf(answer: StreamedHttpResponse): number | undefined {
  const seconds = Number(answer.headers["retry-after"]);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

// A status that is not a success: a redirect is never followed, 429 rests the server, any other
// is an answer that did not reach the call.
function statusFailure(answer: StreamedHttpResponse): ListedFailure {
  if (redirects.has(answer.status)) {
    return { reason: "refused", status: answer.status };
  }
  if (answer.status === 429) {
    const retryAfterSeconds = retryAfterOf(answer);
    return {
      reason: "rate_limited",
      status: 429,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  return { reason: "unreachable", status: answer.status };
}

function decoded(bytes: Uint8Array): string | undefined {
  try {
    return utf8.decode(bytes);
  } catch {
    return undefined;
  }
}

// The answer the transport reads: whole, checked, with only the headers it needs. A text nested
// past 64 levels anywhere a parser would walk (decision 0417), and a request of the server's, are
// refused before the transport sees them.
async function answerOf(
  parts: ListingFetchParts,
  answer: StreamedHttpResponse,
  sent: Sent,
): Promise<Response> {
  // A body past the cap stops being read at its first byte too many, and its connection closes.
  const read = await readBodyStart(answer.body, parts.maxBytes);
  if (read.cut) {
    throw failed(parts, { reason: "too_large", status: answer.status }, sent);
  }
  const sessionId = answer.headers["mcp-session-id"];
  const headers = sessionId === undefined ? {} : { "mcp-session-id": sessionId };
  if (read.bytes.byteLength === 0) {
    return new Response(null, { status: answer.status, headers });
  }
  const type = baseType(answer.headers["content-type"]);
  const text = decoded(read.bytes);
  const texts = text === undefined ? [] : jsonTexts(type, text);
  if (
    !readTypes.has(type) ||
    text === undefined ||
    texts.some((json) => nestsDeeperThan(json)) ||
    holdsServerRequest(texts)
  ) {
    throw failed(parts, { reason: "bad_answer", status: answer.status }, sent);
  }
  return new Response(text, {
    status: answer.status,
    headers: { ...headers, "content-type": type },
  });
}

// The request that leaves: the listing's URL, the headers the transport may send, a text body,
// within its own deadline.
function requestOf(
  parts: ListingFetchParts,
  init: RequestInit | undefined,
  sent: Sent & { readonly signal: AbortSignal },
): HttpRequest {
  const body = typeof init?.body === "string" ? init.body : undefined;
  const { method, signal } = sent;
  const request = { method, url: parts.url, headers: headersOf(init), signal, publicOnly: true };
  return body === undefined ? request : { ...request, body };
}

async function opened(
  parts: ListingFetchParts,
  request: HttpRequest,
  sent: Sent,
): Promise<StreamedHttpResponse> {
  try {
    return await parts.http.open(request);
  } catch (error) {
    if (!(error instanceof BinferenceError) || request.signal.aborted) {
      throw error;
    }
    const reason = error.code === "http.private_address" ? "refused" : "unreachable";
    throw failed(parts, { reason }, sent);
  }
}

// The method of a request to the listing's URL alone; any other URL is refused unsent.
function methodOf(
  parts: ListingFetchParts,
  input: string | URL,
  init: RequestInit | undefined,
): "GET" | "POST" | "DELETE" {
  const url = typeof input === "string" ? input : input.href;
  const method = (init?.method ?? "GET").toUpperCase();
  if (!URL.canParse(url) || new URL(url).href !== parts.url) {
    throw failed(parts, { reason: "refused" });
  }
  if (method !== "GET" && method !== "POST" && method !== "DELETE") {
    throw failed(parts, { reason: "refused" });
  }
  return method;
}

// A request's body as text: the transport sends JSON text, so any other body is refused unsent.
function bodyText(parts: ListingFetchParts, init: RequestInit | undefined): string {
  const body = init?.body ?? "";
  if (typeof body !== "string") {
    throw failed(parts, { reason: "refused" });
  }
  return body;
}

// What a POST or a DELETE is for, and the time it has; none for a POST that names no method,
// which is a reply binference never sends.
function sentOf(
  parts: ListingFetchParts,
  method: "POST" | "DELETE",
  init: RequestInit | undefined,
): Sent | undefined {
  const call = new Headers(init?.headers).get(listedCallHeader) ?? undefined;
  if (method === "DELETE") {
    return { method, timeoutMs: parts.deadlines.closeMs, call };
  }
  const message = clientMessageSchema.safeParse(jsonOfText(bodyText(parts, init)));
  if (!message.success) {
    return undefined;
  }
  const isCall = message.data.method === "tools/call";
  return { method, timeoutMs: isCall ? parts.deadlines.callMs : parts.deadlines.connectMs, call };
}

// Sends one request within its own deadline, and reads its answer whole.
async function exchange(
  parts: ListingFetchParts,
  init: RequestInit | undefined,
  sent: Sent,
): Promise<Response> {
  const parent = init?.signal ?? new AbortController().signal;
  const deadline = createDeadline({
    clock: parts.clock,
    signal: parent,
    timeoutMs: sent.timeoutMs,
  });
  try {
    const answer = await opened(
      parts,
      requestOf(parts, init, { ...sent, signal: deadline.signal }),
      sent,
    );
    if (answer.status < 200 || answer.status > 299) {
      await discardBody(answer.body);
      throw failed(parts, statusFailure(answer), sent);
    }
    return await answerOf(parts, answer, sent);
  } catch (error) {
    if (deadline.signal.aborted && !parent.aborted) {
      throw failed(parts, { reason: "timed_out" }, sent);
    }
    throw error;
  } finally {
    deadline.clear();
  }
}

/**
 * The fetch a listed server's transport gets (decision 0430). It sends only to the listing's URL,
 * exactly, with `publicOnly` set, through the runtime's outbound HTTP; only `POST` and `DELETE`
 * leave, and a `GET` is answered `405` here, so no stream waits open for what a server sends
 * unasked. A `POST` that names no method, a reply to a server, is answered `202` here and never
 * sent. It sends the content's type, what it accepts and the protocol's `mcp-` headers. Each
 * request has its own deadline, a call's for `tools/call`, the connection's for any other, 2
 * seconds for a session's end, and at most 8 are in flight. Each answer is read whole, at most the
 * listing's cap; a redirect, a cap passed, a type other than JSON or an event stream, text nested
 * past 64 levels, a request of the server's, a status that is not a success and a request that got
 * no answer each reach `onFailure` with their reason before the transport sees the failure. A
 * `set-cookie` or any header but the session's id never reaches the transport.
 */
export function listingFetch(parts: ListingFetchParts): ListingFetch {
  let inFlight = 0;
  return async (input, init) => {
    const method = methodOf(parts, input, init);
    if (method === "GET") {
      return new Response(null, { status: 405 });
    }
    const sent = sentOf(parts, method, init);
    if (sent === undefined) {
      return new Response(null, { status: 202 });
    }
    if (inFlight >= maxInFlight) {
      throw failed(parts, { reason: "busy" }, sent);
    }
    inFlight += 1;
    try {
      return await exchange(parts, init, sent);
    } finally {
      inFlight -= 1;
    }
  };
}
