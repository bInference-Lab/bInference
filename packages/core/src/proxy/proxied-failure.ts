import { BinferenceError } from "../errors/binference-error.js";
import type { HttpRequest } from "../http-exchange.js";

// What a request through the proxy fails with. The cause is never kept: the errors of the
// connection to the proxy name its address, which is the owner's secret.

// The codes of a connection to the proxy that never opened: with the request tunnelled, binference
// connects to the proxy alone, and the proxy connects to the host. A reset is left out: one after
// the tunnel opened is the host's, and undici reports a reset before it as `UND_ERR_PRX_CONN`.
const unreachableCodes: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_PRX_CONN",
  "UND_ERR_PRX_TLS",
]);

// The proxy's answer to the tunnel, as undici words it: `Proxy response (407) !== 200 ...`.
const tunnelAnswer = /\bProxy response \((\d{3})\)|\bProxy Authentication Required \((407)\)/;

function codeOf(cause: ErrorOptions["cause"]): string {
  const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : "";
  return typeof code === "string" ? code : "";
}

function messageOf(cause: ErrorOptions["cause"]): string {
  return cause instanceof Error ? cause.message : "";
}

function failure(
  request: Pick<HttpRequest, "method" | "url">,
  problem: {
    readonly code: `http.${string}`;
    readonly message: string;
    readonly retryable: boolean;
  },
  extra: Readonly<Record<string, number>> = {},
): BinferenceError {
  return new BinferenceError({
    ...problem,
    details: { method: request.method, origin: new URL(request.url).origin, ...extra },
  });
}

function answered(request: HttpRequest, status: number): BinferenceError {
  if (status === 407) {
    return failure(request, {
      code: "http.proxy_auth",
      message:
        "The proxy asks for a user name and password, or refused them; put them in the proxy URL network.proxy names.",
      retryable: false,
    });
  }
  return failure(
    request,
    {
      code: "http.proxy_refused",
      message:
        "The proxy refused to reach the host, or could not; check the proxy's own rules, or add the host to network.noProxy.",
      retryable: status >= 500,
    },
    { status },
  );
}

/**
 * Throws what an adapter rejects with when a request through the proxy failed: the signal's
 * reason when it aborted; a `BinferenceError` as it is; `http.proxy_auth` when the proxy answered
 * 407; `http.proxy_refused` with the proxy's status for any other answer to the tunnel, retryable
 * from 500 up; a retryable `http.proxy_unreachable` when the connection to the proxy failed or
 * timed out; else a retryable `http.unreachable`. Each names only the method and the request's
 * origin, and none keeps the cause, which may name the proxy.
 */
export function throwProxiedFailure(request: HttpRequest, cause: ErrorOptions["cause"]): never {
  if (request.signal.aborted) {
    throw request.signal.reason;
  }
  if (cause instanceof BinferenceError) {
    throw cause;
  }
  const status = tunnelAnswer.exec(messageOf(cause));
  if (status !== null) {
    throw answered(request, Number(status[1] ?? status[2]));
  }
  if (unreachableCodes.has(codeOf(cause))) {
    throw failure(request, {
      code: "http.proxy_unreachable",
      message:
        "No connection to the proxy opened; start the proxy, or fix the address network.proxy names.",
      retryable: true,
    });
  }
  throw failure(request, {
    code: "http.unreachable",
    message: "No answer came through the proxy.",
    retryable: true,
  });
}
