import { BinferenceError, type Http, type HttpRequest, type HttpResponse } from "@binference/core";
// oxlint-disable-next-line eslint/no-restricted-imports -- the one outbound Http adapter: every other package reaches the network through the Http port
import { Agent, request as send } from "undici";

/** The outbound Http adapter of a CLI process, with the connection pool it holds. */
export interface SystemHttp extends Http {
  /** Closes the pool's idle connections, so the process can end at once. */
  close(): Promise<void>;
}

// An answer binference reads is small JSON; a larger one is refused before it fills memory.
const maxBodyBytes = 8 * 1024 * 1024;

function headersOf(raw: Readonly<Record<string, string | string[] | undefined>>) {
  return Object.fromEntries(
    Object.entries(raw).flatMap(([name, value]) =>
      value === undefined ? [] : [[name.toLowerCase(), [value].flat().join(", ")]],
    ),
  );
}

function unreachable(request: HttpRequest, cause: ErrorOptions["cause"]): BinferenceError {
  return new BinferenceError({
    code: "http.unreachable",
    message: "No answer came from the server.",
    retryable: true,
    cause,
    details: { method: request.method, origin: new URL(request.url).origin },
  });
}

function tooLarge(request: HttpRequest): BinferenceError {
  return new BinferenceError({
    code: "http.answer_too_large",
    message: `The answer is larger than ${String(maxBodyBytes)} bytes.`,
    details: { method: request.method, origin: new URL(request.url).origin },
  });
}

async function readBody(chunks: AsyncIterable<Uint8Array>, request: HttpRequest): Promise<string> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.byteLength;
    if (size > maxBodyBytes) {
      throw tooLarge(request);
    }
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}

async function exchange(agent: Agent, request: HttpRequest): Promise<HttpResponse> {
  const answer = await send(request.url, {
    dispatcher: agent,
    method: request.method,
    headers: { ...request.headers },
    ...(request.body === undefined ? {} : { body: request.body }),
    signal: request.signal,
  });
  return {
    status: answer.statusCode,
    headers: headersOf(answer.headers),
    body: await readBody(answer.body, request),
  };
}

/**
 * The CLI's outbound HTTP, over undici with a connection pool of its own: it follows no
 * redirect, answers every status as it came, and reads at most 8 MiB of an answer
 * (`http.answer_too_large`). A request that gets no answer rejects with a retryable
 * `http.unreachable` naming only the method and the origin, never the path, a header or a body;
 * one whose signal aborts rejects with the signal's reason.
 */
export function createSystemHttp(): SystemHttp {
  const agent = new Agent();
  return {
    async request(request) {
      request.signal.throwIfAborted();
      try {
        return await exchange(agent, request);
      } catch (error) {
        if (request.signal.aborted) {
          throw request.signal.reason;
        }
        throw error instanceof BinferenceError ? error : unreachable(request, error);
      }
    },
    close: async () => agent.close(),
  };
}
