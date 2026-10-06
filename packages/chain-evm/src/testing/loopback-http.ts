// oxlint-disable-next-line eslint/no-restricted-imports -- tests reach loopback RPC servers through this adapter only
import { type IncomingMessage, request as sendRequest } from "node:http";
import { BinferenceError, type Http, type HttpRequest, type HttpResponse } from "@binference/core";

function lowercaseHeaders(message: IncomingMessage): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(message.headers).map(([name, value]) => [
      name.toLowerCase(),
      [value].flat().join(", "),
    ]),
  );
}

function refuseHost(url: URL): BinferenceError {
  return new BinferenceError({
    code: "http.not_loopback",
    message: "The loopback adapter only reaches http://127.0.0.1.",
    details: { protocol: url.protocol },
  });
}

function unreachable(cause: Readonly<Error>): BinferenceError {
  return new BinferenceError({
    code: "http.unreachable",
    message: "No answer came from the loopback server.",
    retryable: true,
    cause,
  });
}

function send(request: HttpRequest, url: URL): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const fail = (error: Readonly<Error>): void => {
      reject(request.signal.aborted ? request.signal.reason : unreachable(error));
    };
    const outgoing = sendRequest(
      url,
      { method: request.method, headers: request.headers, signal: request.signal },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("error", fail);
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode ?? 0,
            headers: lowercaseHeaders(incoming),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    outgoing.on("error", fail);
    outgoing.end(request.body);
  });
}

/**
 * Creates an Http adapter over `node:http` for tests that serve endpoints on 127.0.0.1, such as a
 * hanging RPC node or an anvil fork. It refuses every other host, so a test never reaches the
 * network, and it stops a request at once when its signal aborts.
 */
export function createLoopbackHttp(): Http {
  return {
    async request(request) {
      request.signal.throwIfAborted();
      const url = new URL(request.url);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
        throw refuseHost(url);
      }
      return send(request, url);
    },
  };
}
