import {
  answerHeaders,
  type HttpRequest,
  outboundInit,
  throwOutboundFailure,
  throwProxiedFailure,
} from "@binference/core";
// oxlint-disable-next-line eslint/no-restricted-imports -- the connection pools of the outbound HTTP adapters, which alone reach the network
import { type Dispatcher, request as send } from "undici";

/**
 * The pool a request goes by, whether it goes through the owner's proxy, and where it is sent: its
 * own URL, or, for a public-only `http:` request through the proxy, the address binference
 * checked, with the name kept in `host`.
 */
export interface PickedPool {
  readonly dispatcher: Dispatcher;
  readonly proxied: boolean;
  /** The URL to send to. */
  readonly url: string;
  /** The `host` header to send, when the URL names an address in place of the host's name. */
  readonly host?: string;
}

/** An answer as it came: its status, its headers named in lowercase, and its body as it streams. */
export interface SentAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
}

// A failure through the proxy never keeps its cause, which may name the proxy.
function throwFailure(
  request: HttpRequest,
  picked: PickedPool,
  cause: ErrorOptions["cause"],
): never {
  return picked.proxied
    ? throwProxiedFailure(request, cause)
    : throwOutboundFailure(request, cause);
}

async function* guardedBody(
  body: AsyncIterable<Uint8Array>,
  failure: { readonly request: HttpRequest; readonly picked: PickedPool },
): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of body) {
      yield chunk;
    }
  } catch (cause) {
    throwFailure(failure.request, failure.picked, cause);
  }
}

/**
 * Sends a request by the pool picked for it, its `user-agent` the adapter's and its `host` the
 * host's name when the pool sends it to an address. A failure, of the request or of its body as
 * it streams, rejects as the adapters reject: through the proxy with the proxy's codes, never its
 * address.
 */
export async function sendPicked(
  request: HttpRequest,
  picked: PickedPool,
  userAgent: string,
): Promise<SentAnswer> {
  try {
    const { headers, ...init } = outboundInit(request, userAgent);
    const sent = picked.host === undefined ? headers : { ...headers, host: picked.host };
    const answer = await send(picked.url, {
      dispatcher: picked.dispatcher,
      ...init,
      headers: sent,
    });
    const body = guardedBody(answer.body, { request, picked });
    return { status: answer.statusCode, headers: answerHeaders(answer.headers), body };
  } catch (cause) {
    return throwFailure(request, picked, cause);
  }
}
