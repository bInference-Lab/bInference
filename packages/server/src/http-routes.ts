import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { EngineState } from "@binference/protocol";

/** The path of a request, `/` when it has none. */
export function pathOf(request: IncomingMessage): string {
  const target = request.url ?? "/";
  return URL.canParse(target, "http://localhost")
    ? new URL(target, "http://localhost").pathname
    : "/";
}

const plain = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

/**
 * Answers a plain HTTP request. `GET /health` answers `200 {"state":"ready"}`, `200
 * {"state":"locked"}` for an engine that serves calls but signs nothing yet, or
 * `503 {"state":"starting"}`; another method there is 405, and any other path 404.
 */
export function answerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: () => EngineState,
): void {
  if (pathOf(request) !== "/health") {
    response.writeHead(404, plain).end();
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405, { ...plain, allow: "GET" }).end();
    return;
  }
  const current = state();
  response
    .writeHead(current === "starting" ? 503 : 200, { ...plain, "content-type": "application/json" })
    .end(JSON.stringify({ state: current }));
}

const statusLines = { 404: "404 Not Found", 503: "503 Service Unavailable" } as const;

/**
 * Answers an upgrade the server refuses with a bare HTTP status, then closes the socket: 404 for a
 * path other than `/ws`, 503 while the server is full or closing.
 */
export function refuseUpgrade(socket: Duplex, status: keyof typeof statusLines): void {
  socket.on("error", () => socket.destroy());
  socket.once("finish", () => socket.destroy());
  socket.end(`HTTP/1.1 ${statusLines[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
