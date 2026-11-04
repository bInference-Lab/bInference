import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { BinferenceError, type Http } from "@binference/core";

/** Why a request through the owner's proxy got no answer from its host. */
type ProxyProblem = "auth" | "refused" | "unreachable" | "noAnswer";

/** How one request through the proxy went: fine, or its problem and the proxy's status. */
export interface ProxyProbe {
  readonly problem?: ProxyProblem;
  /** The status the proxy answered the tunnel with, for `refused`. */
  readonly status?: number;
}

/**
 * The host a probe asks the proxy to reach: Telegram's Bot API, which every install calls and the
 * host owners most often need a proxy for. Any answer from it counts.
 */
export const proxyProbeUrl = "https://api.telegram.org/";

// The probe's own share of the time the caller gives.
const probeTimeoutMs = 10_000;

// undici publishes each tunnel the proxy opened on this channel.
const tunnelChannel = "undici:proxy:connected";

const problemsByCode: Readonly<Record<string, ProxyProblem>> = {
  "http.proxy_auth": "auth",
  "http.proxy_refused": "refused",
  "http.proxy_unreachable": "unreachable",
};

/**
 * What a failed probe's error says about the proxy: its own answer or no connection to it, by the
 * code; a probe that ran out of time before any tunnel opened, a proxy that never answered
 * (`unreachable`); and any other failure, a tunnel that opened with no answer from the host
 * through it (`noAnswer`).
 */
export function probeProblemOf(
  error: ErrorOptions["cause"],
  seen: { readonly hasTimedOut: boolean; readonly isTunnelled: boolean },
): ProxyProbe {
  if (error instanceof BinferenceError) {
    const problem = problemsByCode[error.code];
    const status = error.details["status"];
    if (problem !== undefined) {
      return typeof status === "number" ? { problem, status } : { problem };
    }
  }
  return seen.hasTimedOut && !seen.isTunnelled
    ? { problem: "unreachable" }
    : { problem: "noAnswer" };
}

/**
 * Asks Telegram's Bot API for any answer through `http` by the route in force, within 10 seconds,
 * and says what kept the proxy from carrying it. It names the problem and the proxy's status,
 * never the proxy. Rejects with the caller's signal's reason once it aborts.
 */
export async function probeProxy(http: Http, signal: AbortSignal): Promise<ProxyProbe> {
  const seen = { isTunnelled: false };
  const onTunnel = (): void => {
    seen.isTunnelled = true;
  };
  const timeout = AbortSignal.timeout(probeTimeoutMs);
  subscribe(tunnelChannel, onTunnel);
  try {
    await http.request({
      method: "GET",
      url: proxyProbeUrl,
      signal: AbortSignal.any([signal, timeout]),
    });
    return {};
  } catch (error) {
    signal.throwIfAborted();
    return probeProblemOf(error, { hasTimedOut: timeout.aborted, isTunnelled: seen.isTunnelled });
  } finally {
    unsubscribe(tunnelChannel, onTunnel);
  }
}
