import { BinferenceError, type Http } from "@binference/core";

/** The relays the crash engine's config names: private relays take https URLs only. */
export const crashRelays: readonly string[] = ["https://a.relay.test", "https://b.relay.test"];

const relayHost = /^([a-z]+)\.relay\.test$/;

/**
 * The crash engine's outbound Http: a relay of {@link crashRelays} goes to the test's relay of the
 * same name at `relays`, a request to 127.0.0.1 goes as it is, and every other request fails as
 * one that reaches no host, so a run never reaches the network.
 */
export function crashHttp(http: Http, relays: string): Http {
  return {
    async request(request) {
      const url = new URL(request.url);
      const relay = relayHost.exec(url.hostname)?.[1];
      if (relay !== undefined && url.protocol === "https:") {
        return http.request({ ...request, url: `${relays}/${relay}` });
      }
      if (url.protocol === "http:" && url.hostname === "127.0.0.1") {
        return http.request(request);
      }
      request.signal.throwIfAborted();
      throw new BinferenceError({
        code: "http.unreachable",
        message: "The crash engine reaches only the test's chain and relays.",
        retryable: true,
      });
    },
  };
}
