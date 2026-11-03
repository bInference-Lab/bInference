import { checkPublicUrl, type Clock, type Http, type HttpResponse } from "@binference/core";
import {
  type FetchRefusal,
  type FetchRequestWire,
  type HostMessage,
  maxMessageBytes,
} from "../channel/channel-message.schema.js";

/** The fetches one plugin may have open at once (decision 0300). */
export const maxOpenFetches = 8;
/** How long one fetch waits for its answer. */
export const fetchTimeoutMs = 15_000;

type FetchAnswer = Extract<HostMessage, { readonly kind: "fetched" | "fetchRefused" }>;

/** What one plugin's fetches go through. */
export interface PluginFetchParts {
  readonly http: Http;
  readonly clock: Clock;
  /** The plugin's declared hosts, lowercase. */
  readonly hosts: readonly string[];
  /** Hears each host the plugin asked for and does not declare. */
  onRefused(host: string): void;
}

/** One plugin's fetches: each request checked, sent and answered as a channel message. */
export interface PluginFetches {
  fetch(id: string, request: FetchRequestWire, signal: AbortSignal): Promise<FetchAnswer>;
}

// Headers the host sets itself or that would change how the request travels.
const ownHeaders = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "keep-alive",
  "expect",
]);
const headerName = /^[A-Za-z0-9-]{1,64}$/;
const maxHeaders = 32;

function headersFit(headers: Readonly<Record<string, string>>): boolean {
  const entries = Object.entries(headers);
  return (
    entries.length <= maxHeaders &&
    entries.every(
      ([name, value]) =>
        headerName.test(name) &&
        !ownHeaders.has(name.toLowerCase()) &&
        !name.toLowerCase().startsWith("proxy-") &&
        !/[\r\n\0]/.test(value),
    )
  );
}

type Checked = { readonly url: URL } | { readonly refused: FetchRefusal; readonly host?: string };

// An https URL on the default port of a declared host, with no user, password or private address.
function checked(request: FetchRequestWire, hosts: readonly string[]): Checked {
  const url = checkPublicUrl(request.url);
  if (!url.ok) {
    return { refused: "bad_request" };
  }
  const host = url.value.hostname;
  if (url.value.protocol !== "https:" || url.value.port !== "" || !hosts.includes(host)) {
    return { refused: "host_refused", host };
  }
  const fits = headersFit(request.headers) && (request.method === "POST" || !("body" in request));
  return fits ? { url: url.value } : { refused: "bad_request" };
}

async function sendWithin(
  parts: Pick<PluginFetchParts, "http" | "clock">,
  request: FetchRequestWire & { readonly url: string },
  signal: AbortSignal,
): Promise<HttpResponse | "timeout" | "failed"> {
  const limit = new AbortController();
  const timer = new AbortController();
  void parts.clock.sleep(fetchTimeoutMs, AbortSignal.any([signal, timer.signal])).then(
    () => limit.abort(),
    () => undefined,
  );
  try {
    return await parts.http.request({
      method: request.method,
      url: request.url,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: AbortSignal.any([signal, limit.signal]),
      publicOnly: true,
    });
  } catch {
    return limit.signal.aborted ? "timeout" : "failed";
  } finally {
    timer.abort();
  }
}

/**
 * Makes one plugin's fetches (decision 0300): an `https` URL on the default port of a host the
 * plugin declares, past the URL guard and to public addresses only, with headers the host does
 * not set itself, at most 8 open at once, each answered in 15 seconds and in one channel message.
 * A request to any other host is refused as `host_refused` and named to `onRefused`; the plugin
 * gets every other failure as its refusal code, never an error's text.
 */
export function createPluginFetches(parts: PluginFetchParts): PluginFetches {
  let open = 0;
  return {
    fetch: async (id, request, signal) => {
      const refuse = (refused: FetchRefusal): FetchAnswer => ({
        kind: "fetchRefused",
        id,
        refused,
      });
      const check = checked(request, parts.hosts);
      if ("refused" in check) {
        if (check.refused === "host_refused" && check.host !== undefined) {
          parts.onRefused(check.host);
        }
        return refuse(check.refused);
      }
      if (open >= maxOpenFetches) {
        return refuse("busy");
      }
      open += 1;
      try {
        const answer = await sendWithin(parts, { ...request, url: check.url.href }, signal);
        if (typeof answer === "string") {
          return refuse(answer);
        }
        const { status, headers, body } = answer;
        const fetched: FetchAnswer = { kind: "fetched", id, status, headers, body };
        return Buffer.byteLength(JSON.stringify(fetched)) < maxMessageBytes
          ? fetched
          : refuse("too_large");
      } finally {
        open -= 1;
      }
    },
  };
}
