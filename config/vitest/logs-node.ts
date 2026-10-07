import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { text } from "node:stream/consumers";
import { z } from "zod";
import { retryFlakes } from "./retry-flakes.js";

/** A JSON-RPC endpoint on 127.0.0.1 that reads history from a public node serving eth_getLogs. */
export interface LogsNode {
  readonly url: string;
  /** Stops listening and closes open connections. */
  close(): Promise<void>;
}

interface Answer {
  readonly status: number;
  readonly body: string;
}

// Reads only: a fork test that sends a signed transaction here by mistake must never reach BSC.
const readMethods = new Set(["eth_getLogs", "eth_blockNumber", "eth_chainId"]);
const requestSchema = z.looseObject({ method: z.string() });
const callTimeoutMs = 30_000;
const waitsMs = [1_000, 3_000, 9_000];

function isFlaky(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

async function ask(upstream: string, body: string): Promise<Answer> {
  const response = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(callTimeoutMs),
  });
  if (isFlaky(response.status)) {
    throw new Error(`${new URL(upstream).host} answered HTTP ${String(response.status)}.`);
  }
  return { status: response.status, body: await response.text() };
}

function refusal(message: string): Answer {
  const error = { code: -32_000, message };
  return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: null, error }) };
}

async function answer(upstream: string, request: IncomingMessage): Promise<Answer> {
  const body = await text(request);
  const parsed = requestSchema.safeParse(JSON.parse(body));
  if (!parsed.success || !readMethods.has(parsed.data.method)) {
    return refusal(`The logs node forwards ${[...readMethods].join(", ")} only.`);
  }
  try {
    return await retryFlakes({ label: "The logs node", waitsMs }, async () => ask(upstream, body));
  } catch (error) {
    return refusal(error instanceof Error ? `${error.message} ${String(error.cause)}` : "failed");
  }
}

async function forward(
  upstream: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const { status, body } = await answer(upstream, request).catch((error: unknown) =>
    refusal(`The logs node could not read the request: ${String(error)}`),
  );
  response.writeHead(status, { "content-type": "application/json" }).end(body);
}

/**
 * Serves a loopback endpoint in front of `upstream`, a public node that serves `eth_getLogs`.
 * Fork tests reach only loopback; this endpoint reaches the network for them, for reads alone,
 * and tries again when the node answers a burst with 403, 429 or a 5xx.
 */
export async function serveLogsNode(upstream: string): Promise<LogsNode> {
  const server = createServer((request, response) => {
    forward(upstream, request, response).catch(() => response.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The logs node did not get a TCP port.");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
