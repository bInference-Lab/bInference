import type { Http } from "@binference/core";

// The model evaluation reaches a candidate model on the internet, or on this machine's loopback for
// a model server the owner runs (decision 0291). Every other request stays public-only, as the
// agent's own requests are: a name resolving to a private address, or a private address itself,
// is refused with `http.private_address`.

const loopbackHosts: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]", "localhost"]);

function isLoopback(url: string): boolean {
  return loopbackHosts.has(new URL(url).hostname);
}

/**
 * The evaluation's outbound HTTP over `http`: a request to 127.0.0.1, ::1 or localhost goes out as
 * it came, and every other request, and any request its caller marked public-only, goes out
 * public-only.
 */
export function createEvaluationHttp(http: Http): Http {
  return {
    request: async (request) =>
      http.request({
        ...request,
        publicOnly: request.publicOnly === true || !isLoopback(request.url),
      }),
  };
}
