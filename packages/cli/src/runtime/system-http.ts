import { lookup as systemLookup } from "node:dns";
import type { HeadSocket } from "@binference/chain-evm";
import {
  BinferenceError,
  type DownloadAnswer,
  type Http,
  type HttpDownload,
  type HostLookup,
  type HttpRequest,
  type OutboundRoute,
  throwOutboundFailure,
} from "@binference/core";
import { createOutboundPools, type OutboundPools } from "@binference/platform/outbound";

/**
 * Where the engine puts the route of its outbound requests in force, from `network.proxy` and
 * `network.noProxy`, and opens its WebSockets by it.
 */
interface OutboundSwitch {
  /**
   * Puts the route in force for every request and socket that starts from now on; one under way
   * finishes as it started, but a different route closes the sockets the old one opened, so their
   * owners open them again by the new one.
   */
  use(route: OutboundRoute): void;
  /**
   * Opens a WebSocket by the route in force, such as a chain's block subscription; throws
   * `http.proxy_unusable` while the route holds its host, and `http.no_route` before any route.
   */
  openSocket(url: string): HeadSocket;
}

/** The outbound Http adapter of a CLI process, with the connection pools it holds. */
export interface SystemHttp extends Http, HttpDownload, OutboundSwitch {
  /** Closes the pools' idle connections, so the process can end at once. */
  close(): Promise<void>;
}

/** What the adapter names itself with. */
export interface SystemHttpOptions {
  /** The running binference's version, which every request names in its `user-agent`. */
  readonly version: string;
  /** How a host is looked up; the system's resolver when none is given. */
  readonly lookup?: HostLookup;
  /**
   * The route in force from the start, such as a test's direct one; none refuses every request
   * until `use` (decision 0347).
   */
  readonly route?: OutboundRoute;
}

// An answer binference reads is small JSON; a larger one is refused before it fills memory.
const maxBodyBytes = 8 * 1024 * 1024;

function tooLarge(request: HttpRequest, maxBytes: number): BinferenceError {
  return new BinferenceError({
    code: "http.answer_too_large",
    message: `The answer is larger than ${String(maxBytes)} bytes.`,
    details: { method: request.method, origin: new URL(request.url).origin },
  });
}

/** An answer as it came, its body read as bytes. */
interface ReadAnswer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly bytes: Buffer;
}

async function readBytes(
  chunks: AsyncIterable<Uint8Array>,
  request: HttpRequest,
  maxBytes: number,
): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      throw tooLarge(request, maxBytes);
    }
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

// One exchange by the route in force, its body read up to `maxBytes`.
async function exchange(
  request: HttpRequest,
  context: { readonly pools: OutboundPools; readonly userAgent: string; readonly maxBytes: number },
): Promise<ReadAnswer> {
  const answer = await context.pools.send(request, context.userAgent);
  const bytes = await readBytes(answer.body, request, context.maxBytes);
  return { status: answer.status, headers: answer.headers, bytes };
}

async function failing<T>(request: HttpRequest, run: () => Promise<T>): Promise<T> {
  request.signal.throwIfAborted();
  try {
    return await run();
  } catch (cause) {
    return throwOutboundFailure(request, cause);
  }
}

/**
 * The CLI's outbound HTTP, over undici with connection pools of its own: it sends a text body
 * or a body of bytes (`http.two_bodies` for both), follows no redirect, answers every status as
 * it came, and reads at most 8 MiB of an answer (`http.answer_too_large`). Every request names
 * binference as `user-agent: binference/<version>`, in place of any user agent the caller set, so
 * each service sees one name: some refuse a request with none, as KyberSwap's edge does. A
 * download reads the answer as bytes, up to its own `maxBytes`, the same way.
 *
 * Requests and sockets go by the route in force, and none goes out before one is
 * (`http.no_route`): through the owner's proxy as a tunnel but for this machine, addresses off the
 * internet and the no-proxy list, and not at all while the proxy set cannot be read
 * (`http.proxy_unusable`). A request that gets no answer rejects with a retryable
 * `http.unreachable` naming only the method and the origin, never the path, a header or a body;
 * through the proxy also with `http.proxy_auth`, `http.proxy_refused` or
 * `http.proxy_unreachable`, never naming the proxy. One whose signal aborts rejects with the
 * signal's reason. A direct `publicOnly` request connects only to the public addresses its host
 * resolves to, checked at connect time so a name cannot rebind to a private one. Through the
 * proxy, its name is checked here first; an `http:` one is then sent to the address checked here,
 * so the proxy cannot resolve the name elsewhere, and an `https:` one keeps its name, which TLS
 * binds to the host's certificate. It rejects with `http.private_address` otherwise.
 */
export function createSystemHttp(options: SystemHttpOptions): SystemHttp {
  const pools = createOutboundPools({
    lookup: options.lookup ?? systemLookup,
    lookupAll: options.lookup !== undefined,
    ...(options.route === undefined ? {} : { route: options.route }),
  });
  const userAgent = `binference/${options.version}`;
  return {
    async request(request) {
      return failing(request, async () => {
        const answer = await exchange(request, { pools, userAgent, maxBytes: maxBodyBytes });
        return { ...answer, body: answer.bytes.toString("utf8") };
      });
    },
    async download(download) {
      const { url, signal, maxBytes } = download;
      const request: HttpRequest = { method: "GET", url, signal };
      return failing<DownloadAnswer>(request, async () => {
        const answer = await exchange(request, { pools, userAgent, maxBytes });
        return { status: answer.status, headers: answer.headers, bytes: answer.bytes };
      });
    },
    use: (route) => pools.use(route),
    openSocket: (url) => pools.openSocket(url),
    close: async () => pools.close(),
  };
}
