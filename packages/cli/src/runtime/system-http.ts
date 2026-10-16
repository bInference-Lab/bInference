import { lookup } from "node:dns";
import {
  answerHeaders,
  BinferenceError,
  type DownloadAnswer,
  type DownloadRequest,
  type Http,
  type HttpDownload,
  type HttpRequest,
  type HttpResponse,
  outboundInit,
  publicOnlyLookup,
  refusePrivateAddressHost,
  throwOutboundFailure,
} from "@binference/core";
// oxlint-disable-next-line eslint/no-restricted-imports -- the one outbound Http adapter: every other package reaches the network through the Http port
import { Agent, request as send } from "undici";

/** The outbound Http adapter of a CLI process, with the connection pool it holds. */
export interface SystemHttp extends Http, HttpDownload {
  /** Closes the pool's idle connections, so the process can end at once. */
  close(): Promise<void>;
}

/** What the adapter names itself with. */
export interface SystemHttpOptions {
  /** The running binference's version, which every request names in its `user-agent`. */
  readonly version: string;
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

/** The connection pools: one for any address, one that reaches public addresses only. */
interface Agents {
  readonly any: Agent;
  readonly publicOnly: Agent;
}

function agentFor(agents: Agents, request: HttpRequest): Agent {
  refusePrivateAddressHost(request);
  return request.publicOnly === true ? agents.publicOnly : agents.any;
}

async function exchange(
  agents: Agents,
  request: HttpRequest,
  userAgent: string,
): Promise<HttpResponse> {
  const init = outboundInit(request, userAgent);
  const answer = await send(request.url, { dispatcher: agentFor(agents, request), ...init });
  return {
    status: answer.statusCode,
    headers: answerHeaders(answer.headers),
    body: (await readBytes(answer.body, request, maxBodyBytes)).toString("utf8"),
  };
}

// A download is a GET with no body, read as bytes up to its own limit.
async function fetchBytes(
  agents: Agents,
  download: DownloadRequest,
  userAgent: string,
): Promise<DownloadAnswer> {
  const request: HttpRequest = { method: "GET", url: download.url, signal: download.signal };
  const init = outboundInit(request, userAgent);
  const answer = await send(request.url, { dispatcher: agentFor(agents, request), ...init });
  return {
    status: answer.statusCode,
    headers: answerHeaders(answer.headers),
    bytes: await readBytes(answer.body, request, download.maxBytes),
  };
}

/**
 * The CLI's outbound HTTP, over undici with a connection pool of its own: it sends a text body
 * or a body of bytes (`http.two_bodies` for both), follows no redirect, answers every status as
 * it came, and reads at most 8 MiB of an answer
 * (`http.answer_too_large`). Every request names binference as `user-agent:
 * binference/<version>`, in place of any user agent the caller set, so each service sees one
 * name: some refuse a request with none, as KyberSwap's edge does. A request that gets no answer
 * rejects with a retryable `http.unreachable` naming only the method and the origin, never the
 * path, a header or a body; one whose signal aborts rejects with the signal's reason. A download
 * reads the answer as bytes, up to its own `maxBytes`, the same way. A
 * `publicOnly` request connects only to the public addresses its host resolves to, checked at
 * connect time so a name cannot rebind to a private one, and rejects with `http.private_address`
 * otherwise.
 */
export function createSystemHttp(options: SystemHttpOptions): SystemHttp {
  const agents = {
    any: new Agent(),
    publicOnly: new Agent({ connect: { lookup: publicOnlyLookup(lookup) } }),
  };
  const userAgent = `binference/${options.version}`;
  return {
    async request(request) {
      request.signal.throwIfAborted();
      try {
        return await exchange(agents, request, userAgent);
      } catch (error) {
        return throwOutboundFailure(request, error);
      }
    },
    async download(download) {
      download.signal.throwIfAborted();
      try {
        return await fetchBytes(agents, download, userAgent);
      } catch (error) {
        const { url, signal } = download;
        return throwOutboundFailure({ method: "GET", url, signal }, error);
      }
    },
    close: async () => {
      await Promise.all([agents.any.close(), agents.publicOnly.close()]);
    },
  };
}
