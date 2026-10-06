// oxlint-disable-next-line eslint/no-restricted-imports -- tests serve RPC endpoints on loopback; nothing ships a listener
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";

/** What a loopback server sends back for one request body. */
interface LoopbackAnswer {
  readonly status: number;
  readonly body: string;
}

/** Answers a request body, or holds the request open with `"hang"`. */
export type LoopbackHandler = (body: string) => LoopbackAnswer | "hang";

/** A local HTTP server for tests. */
export interface LoopbackServer {
  readonly url: string;
  /** How many requests it has received. */
  readonly received: () => number;
  /** Resolves when the first request's body has arrived. */
  readonly firstRequest: Promise<void>;
  /** Resolves when a client drops a request the server held open. */
  readonly dropped: Promise<void>;
  /** Stops the server and closes every open connection. */
  close(): Promise<void>;
}

function readBody(incoming: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    incoming.on("error", reject);
  });
}

interface Latch {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

function createLatch(): Latch {
  const openers: (() => void)[] = [];
  const promise = new Promise<void>((resolve) => {
    openers.push(resolve);
  });
  return {
    promise,
    open: () => {
      for (const open of openers) {
        open();
      }
    },
  };
}

const boundSchema = z.object({ port: z.int().positive() });

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = boundSchema.parse(server.address());
      resolve(`http://127.0.0.1:${String(port)}`);
    });
  });
}

/** Starts an HTTP server on a free loopback port that answers with the handler. */
export async function serveLoopback(handler: LoopbackHandler): Promise<LoopbackServer> {
  let count = 0;
  const first = createLatch();
  const dropped = createLatch();
  const respond = async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    const answer = handler(await readBody(incoming));
    count += 1;
    first.open();
    if (answer === "hang") {
      outgoing.on("close", dropped.open);
      return;
    }
    outgoing.writeHead(answer.status, { "content-type": "application/json" }).end(answer.body);
  };
  const server = createServer((incoming, outgoing) => {
    void respond(incoming, outgoing);
  });
  const url = await listen(server);
  return {
    url,
    received: () => count,
    firstRequest: first.promise,
    dropped: dropped.promise,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A loopback URL where nothing listens, so a connection is refused at once. */
export async function refusingLoopbackUrl(): Promise<string> {
  const server = await serveLoopback(() => "hang");
  await server.close();
  return server.url;
}
