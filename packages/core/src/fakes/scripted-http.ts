import { BinferenceError } from "../errors/binference-error.js";
import type { HttpMethod, HttpRequest, HttpResponse } from "../http-exchange.js";
import type { Http } from "../ports.js";

/** One canned answer of a {@link ScriptedHttp}. */
export interface ScriptedRoute {
  readonly method: HttpMethod;
  readonly url: string;
  readonly response: HttpResponse;
}

/** An Http adapter for tests that answers from a list of routes and never touches the network. */
export interface ScriptedHttp extends Http {
  /** The requests it received, oldest first. */
  requests(): readonly HttpRequest[];
}

const maxRequests = 1_000;

/**
 * Creates a {@link ScriptedHttp}. A request to a URL with no route rejects as unreachable, with
 * a retryable `http.unreachable` error, as a real adapter does when no answer comes.
 */
export function createScriptedHttp(routes: readonly ScriptedRoute[]): ScriptedHttp {
  const received: HttpRequest[] = [];
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      request.signal.throwIfAborted();
      received.push(request);
      if (received.length > maxRequests) {
        received.shift();
      }
      const route = routes.find(
        (item) => item.method === request.method && item.url === request.url,
      );
      if (route === undefined) {
        throw new BinferenceError({
          code: "http.unreachable",
          message: "No route answers this request.",
          retryable: true,
          details: { method: request.method },
        });
      }
      return route.response;
    },
    requests: () => [...received],
  };
}
