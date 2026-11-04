import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- a file server on the loopback for tests: no outbound request
import { createServer } from "node:http";

/** What the server answers for a path: a file's bytes, or a redirect to another address. */
export type LoopbackAnswer = { readonly body: Uint8Array } | { readonly redirectTo: string };

/** A file server on 127.0.0.1 that stands in for a download host in tests. */
export interface LoopbackFiles {
  /** Its origin, such as `http://127.0.0.1:41234`. */
  readonly base: string;
  /** The paths it was asked for, oldest first. */
  requests(): readonly string[];
  close(): Promise<void>;
}

// Scripts go out as UTF-8 text, as a host of the install scripts must serve them, so PowerShell
// reads their Chinese lines right; anything else as bytes.
function typeOf(path: string): string {
  return /\.(?:sh|ps1|sha256)$/.test(path)
    ? "text/plain; charset=utf-8"
    : "application/octet-stream";
}

/**
 * Starts a server on 127.0.0.1 alone that answers each GET with what `answerFor` gives its path:
 * 200 with the bytes, 302 to the address, or 404 for nothing. It records every path it is asked.
 */
export async function startLoopbackFiles(
  answerFor: (path: string) => LoopbackAnswer | undefined,
): Promise<LoopbackFiles> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    asked.push(path);
    const answer = request.method === "GET" ? answerFor(path) : undefined;
    if (answer === undefined) {
      response.writeHead(404).end();
    } else if ("redirectTo" in answer) {
      response.writeHead(302, { location: answer.redirectTo }).end();
    } else {
      const headers = {
        "content-length": String(answer.body.byteLength),
        "content-type": typeOf(path),
      };
      response.writeHead(200, headers).end(answer.body);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The loopback file server has no port.");
  }
  return {
    base: `http://127.0.0.1:${String(address.port)}`,
    requests: () => [...asked],
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
