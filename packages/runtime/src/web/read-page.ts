import {
  BinferenceError,
  checkPublicUrl,
  type Clock,
  createDeadline,
  type Deadline,
  type HostLookup,
  resolvesToPublic,
  type UrlRefusal,
} from "@binference/core";
import type { StreamingHttp } from "../providers/ports.js";
import type { StreamedHttpResponse } from "../providers/streamed-http-response.js";
import { decodePage, htmlText } from "./page-text.js";
import { discardBody, readBodyStart } from "./read-body.js";

/** How `read_page` reaches a page: the runtime's outbound HTTP, a name lookup and the clock. */
export interface PageReaderParts {
  readonly http: StreamingHttp;
  readonly lookup: HostLookup;
  readonly clock: Clock;
}

/** The most of a page `read_page` reads (runtime spec, section 7.2). */
export const maxPageBytes: number = 2 * 1024 * 1024;

/** The redirects a read follows, each checked as the first URL. */
export const maxRedirects = 3;

/** How long a whole read may take, redirects included. */
export const pageTimeoutMs = 20_000;

/** A page that was read. */
export interface PageRead {
  readonly kind: "page";
  /** The URL the page came from, after its redirects. */
  readonly url: string;
  readonly title?: string;
  readonly text: string;
  /** The page went on past {@link maxPageBytes}, which were all that was read. */
  readonly cut: boolean;
}

// Why no page was read.
type PageRefusal =
  | UrlRefusal
  /** The host resolves to an address that is not public, or to none. */
  | "private_address"
  | "too_many_redirects"
  | "redirect_without_location"
  /** The server answered with a status other than 2xx; `status` names it. */
  | "status"
  /** The answer is of a type `read_page` does not read; `contentType` names it. */
  | "content_type"
  /** The answer is compressed, though the request asked for no compression. */
  | "encoding"
  | "timeout"
  | "unreachable";

/** A read that ended without a page. */
export interface PageRefused {
  readonly kind: "refused";
  readonly reason: PageRefusal;
  readonly status?: number;
  readonly contentType?: string;
}

const readableTypes: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/xml",
  "application/rss+xml",
  "application/atom+xml",
  "text/csv",
]);

const markupTypes: ReadonlySet<string> = new Set(["text/html", "application/xhtml+xml"]);

const redirectStatuses: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const requestHeaders = {
  accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
  "accept-encoding": "identity",
};

function refused(reason: PageRefusal, facts: Partial<PageRefused> = {}): PageRefused {
  return { ...facts, kind: "refused", reason };
}

function baseType(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

// What a 2xx answer holds: its text when its type is one the tool reads, else why it is not.
async function pageOf(answer: StreamedHttpResponse, url: string): Promise<PageRead | PageRefused> {
  const contentType = answer.headers["content-type"] ?? "";
  const encoding = (answer.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  const type = baseType(contentType);
  if (!readableTypes.has(type) || encoding !== "identity") {
    await discardBody(answer.body);
    return encoding === "identity"
      ? refused("content_type", { contentType: type === "" ? "none" : type })
      : refused("encoding");
  }
  const start = await readBodyStart(answer.body, maxPageBytes);
  const decoded = decodePage(start.bytes, contentType);
  const shown = markupTypes.has(type) ? htmlText(decoded) : { text: decoded.trim() };
  return { kind: "page", url, ...shown, cut: start.cut };
}

// Where a redirect leads, as an absolute URL, or none when its location is missing or unreadable.
function locationOf(answer: StreamedHttpResponse, from: string): string | undefined {
  const location = answer.headers["location"];
  return location !== undefined && URL.canParse(location, from)
    ? new URL(location, from).href
    : undefined;
}

// Checks one URL, reads it, and follows its redirect with one fewer left to follow.
async function follow(
  text: string,
  hopsLeft: number,
  context: { readonly parts: PageReaderParts; readonly signal: AbortSignal },
): Promise<PageRead | PageRefused> {
  const { parts, signal } = context;
  const checked = checkPublicUrl(text);
  if (!checked.ok) {
    return refused(checked.error);
  }
  const url = checked.value.href;
  if (!(await resolvesToPublic(checked.value.hostname, { signal, lookup: parts.lookup }))) {
    return refused("private_address");
  }
  const request = {
    method: "GET",
    url,
    headers: requestHeaders,
    signal,
    publicOnly: true,
  } as const;
  const answer = await parts.http.open(request);
  if (!redirectStatuses.has(answer.status)) {
    if (answer.status >= 200 && answer.status < 300) {
      return pageOf(answer, url);
    }
    await discardBody(answer.body);
    return refused("status", { status: answer.status });
  }
  await discardBody(answer.body);
  const next = locationOf(answer, url);
  if (next === undefined) {
    return refused("redirect_without_location");
  }
  return hopsLeft === 0 ? refused("too_many_redirects") : follow(next, hopsLeft - 1, context);
}

function refusalOf(
  error: ErrorOptions["cause"],
  deadline: Deadline,
  signal: AbortSignal,
): PageRefused {
  if (signal.aborted) {
    throw signal.reason;
  }
  if (deadline.signal.aborted) {
    return refused("timeout");
  }
  if (error instanceof BinferenceError && error.code === "http.private_address") {
    return refused("private_address");
  }
  if (error instanceof BinferenceError && error.code === "http.unreachable") {
    return refused("unreachable");
  }
  throw error;
}

/**
 * Reads one page for `read_page` through the URL guard (decision 0205): the URL and every address
 * its host resolves to must be public, checked again by the connection itself, and so must each
 * of at most 3 redirects. It sends `GET` with no cookie and asks for no compression, reads HTML,
 * text, Markdown, JSON, XML, feeds and CSV only, and reads at most 2 MiB, all within 20 seconds.
 * HTML comes back as its title and text. A refusal names why; it rejects only when `signal`
 * aborts, with its reason, or on a fault that is not the network's.
 */
export async function readPublicPage(
  url: string,
  parts: PageReaderParts,
  signal: AbortSignal,
): Promise<PageRead | PageRefused> {
  const deadline = createDeadline({ clock: parts.clock, signal, timeoutMs: pageTimeoutMs });
  try {
    return await follow(url, maxRedirects, { parts, signal: deadline.signal });
  } catch (error) {
    return refusalOf(error, deadline, signal);
  } finally {
    deadline.clear();
  }
}
