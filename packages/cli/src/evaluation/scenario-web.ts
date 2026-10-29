import type { HostLookup } from "@binference/core";
import type { StreamingHttp, WebToolParts } from "@binference/runtime/testing";
import type { ScenarioWorld } from "./scenario.schema.js";

// The web of one scenario's run: its pages by URL and its search results, through the agent's own
// web tools and their URL guard. Nothing reaches the network.

/** What the scenario's web answers one request with: its status, headers and body's pieces. */
export interface WebAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly chunks: readonly string[];
}

const searchUrl = "https://api.search.brave.com/res/v1/web/search";
// example.com's address, which the URL guard reads as public.
const publicAddress = "93.184.215.14";
const html = { "content-type": "text/html; charset=utf-8" };
const missing: WebAnswer = {
  status: 404,
  headers: html,
  chunks: ["<html><body>Not found</body></html>"],
};

async function* bodyOf(
  chunks: readonly string[],
  signal: AbortSignal,
): AsyncGenerator<Uint8Array, void, undefined> {
  for (const chunk of chunks) {
    signal.throwIfAborted();
    yield new TextEncoder().encode(chunk);
  }
  await Promise.resolve();
}

/** A {@link StreamingHttp} that answers each request with what `answerOf` gives for its URL. */
export function createWebHttp(answerOf: (url: string) => WebAnswer): StreamingHttp {
  return {
    async open(request) {
      request.signal.throwIfAborted();
      const { status, headers, chunks } = answerOf(request.url);
      return Promise.resolve({ status, headers, body: bodyOf(chunks, request.signal) });
    },
  };
}

function answerIn(world: ScenarioWorld, url: string): WebAnswer {
  if (url.startsWith(searchUrl)) {
    const body = JSON.stringify({ web: { results: world.search ?? [] } });
    return { status: 200, headers: { "content-type": "application/json" }, chunks: [body] };
  }
  const page = world.pages?.[url];
  return page === undefined ? missing : { status: 200, headers: html, chunks: [page] };
}

// Every name resolves to one public address, so the URL guard lets each page through.
const publicLookup: HostLookup = (_hostname, _options, callback) => {
  callback(null, [{ address: publicAddress, family: 4 }]);
};

/** The web tools' parts for a scenario: its pages and search results, and a search key. */
export function scenarioWebOf(world: ScenarioWorld, clock: WebToolParts["clock"]): WebToolParts {
  return {
    http: createWebHttp((url) => answerIn(world, url)),
    lookup: publicLookup,
    clock,
    search: { provider: "brave", keys: { brave: "evaluation" } },
  };
}
