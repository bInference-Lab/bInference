// oxlint-disable-next-line eslint/no-restricted-imports -- the live suite and the sweep reach Privy's API themselves, past the unit tests' offline dispatcher
import { request as httpsRequest } from "node:https";
import { BinferenceError, type Http, type HttpRequest, type HttpResponse } from "@binference/core";

function send(request: HttpRequest): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(
      request.url,
      { method: request.method, headers: request.headers, signal: request.signal },
      (incoming) => {
        const parts: Buffer[] = [];
        incoming.on("data", (part: Buffer) => parts.push(part));
        incoming.on("error", reject);
        incoming.on("end", () => {
          const headers = Object.fromEntries(
            Object.entries(incoming.headers).map(([name, value]) => [name, String(value)]),
          );
          resolve({
            status: incoming.statusCode ?? 0,
            headers,
            body: Buffer.concat(parts).toString("utf8"),
          });
        });
      },
    );
    outgoing.on("error", (cause) => {
      reject(
        request.signal.aborted
          ? request.signal.reason
          : new BinferenceError({
              code: "http.unreachable",
              message: "Privy gave no answer.",
              retryable: true,
              cause,
            }),
      );
    });
    outgoing.end(request.body);
  });
}

/**
 * An `Http` over `node:https` for the Privy test app, which the live suite and the leftover sweep
 * reach past the unit tests' offline dispatcher. Each request stops with its signal; nothing
 * retries.
 */
export const liveHttps: Http = { request: async (request) => send(request) };
