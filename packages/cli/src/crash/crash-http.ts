import { BinferenceError, type Http } from "@binference/core";

/** The relays the crash engine's config names: private relays take https URLs only. */
export const crashRelays: readonly string[] = ["https://a.relay.test", "https://b.relay.test"];

/** Where the crash engine's outside world listens on loopback. */
export interface CrashEndpoints {
  /** The test's relays, each at `/<name>`. */
  readonly relays: string;
  /** The fake Privy at `/privy`, KyberSwap's API at `/kyberswap` and Flap's at `/flap`. */
  readonly services: string;
}

const relayHost = /^([a-z]+)\.relay\.test$/;
const services: Readonly<Record<string, string>> = {
  "https://api.privy.io": "privy",
  "https://aggregator-api.kyberswap.com": "kyberswap",
  "https://funcs.flap.sh": "flap",
};

// Where a request of the crash engine goes on loopback: a relay of {@link crashRelays} to the
// test's relay of the same name, an outside service to the test's services, 127.0.0.1 as it is,
// and anything else nowhere.
function routedUrl(given: string, endpoints: CrashEndpoints): string | undefined {
  const url = new URL(given);
  const relay = relayHost.exec(url.hostname)?.[1];
  if (relay !== undefined && url.protocol === "https:") {
    return `${endpoints.relays}/${relay}`;
  }
  const service = services[url.origin];
  if (service !== undefined) {
    return `${endpoints.services}/${service}${url.pathname}${url.search}`;
  }
  return url.protocol === "http:" && url.hostname === "127.0.0.1" ? given : undefined;
}

function unreachable(signal: AbortSignal): never {
  signal.throwIfAborted();
  throw new BinferenceError({
    code: "http.unreachable",
    message: "The crash engine reaches only the test's chain, relays and services.",
    retryable: true,
  });
}

/**
 * The crash engine's outbound Http: a relay of {@link crashRelays} goes to the test's relay of the
 * same name, Privy, KyberSwap's and Flap's APIs go to the test's services, a request
 * to 127.0.0.1 goes as it is, and every other request fails as one that reaches no host, so a run
 * never reaches the network.
 */
export function crashHttp(http: Http, endpoints: CrashEndpoints): Http {
  return {
    async request(request) {
      const url = routedUrl(request.url, endpoints);
      return url === undefined ? unreachable(request.signal) : http.request({ ...request, url });
    },
  };
}
