// oxlint-disable-next-line eslint/no-restricted-imports -- a stand-in model provider on the loopback for tests: no outbound request
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { StreamedAnswer } from "../contracts/streaming-http-contract.js";

/** One request the stand-in received. Header names are lowercase. */
export interface StandInRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A model provider's stand-in on the loopback, for tests that run a real client end to end. */
export interface StandInModelServer {
  /** Its origin, such as `http://127.0.0.1:4000`. */
  readonly origin: string;
  /** The requests it received, oldest first. */
  readonly requests: readonly StandInRequest[];
  close(): Promise<void>;
}

async function textOf(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let text = "";
  for await (const piece of request) {
    text += String(piece);
  }
  return text;
}

function headersOf(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, [value].flat().join(", ")]],
    ),
  );
}

function reply(response: ServerResponse, answer: StreamedAnswer): void {
  response.writeHead(answer.status, { ...answer.headers });
  for (const chunk of answer.chunks) {
    response.write(chunk);
  }
  response.end();
}

/**
 * Starts a stand-in model provider on `127.0.0.1` at a free port: it keeps every request and
 * answers the n-th with the n-th answer, the last one again once they run out, each body piece
 * written as it comes. Close it when the test ends.
 */
export async function startStandInModelServer(
  answers: readonly StreamedAnswer[],
): Promise<StandInModelServer> {
  const requests: StandInRequest[] = [];
  const answer = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const body = await textOf(request);
    const next = answers[Math.min(requests.length, answers.length - 1)];
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      headers: headersOf(request),
      body,
    });
    reply(response, next ?? { status: 500, headers: {}, chunks: [] });
  };
  const server = createServer((request, response) => void answer(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The stand-in model server has no port.");
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: async () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
