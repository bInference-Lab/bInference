import type { Clock, Http } from "@binference/core";
import type { z } from "zod";

/** What every live read shares: an Http over fetch and a wall clock. */
export interface LiveParts {
  readonly http: Http;
  readonly clock: Clock;
  readonly signal: AbortSignal;
}

const userAgent = "binference/0.0.0 (chains:read)";

/** An Http over fetch that names itself, and a clock that sleeps on timers. */
export function liveParts(): LiveParts {
  const http: Http = {
    async request(request) {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers, "user-agent": userAgent },
        body: request.body ?? null,
        signal: request.signal,
      });
      return { status: response.status, headers: {}, body: await response.text() };
    },
  };
  const clock: Clock = {
    now: () => Date.now(),
    sleep: async (delayMs, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      }),
  };
  return { http, clock, signal: AbortSignal.timeout(10 * 60 * 1000) };
}

/** Reads JSON from a bridge's public API with a GET, or a POST when a body is given. */
export async function readJson(url: string, body?: object): Promise<unknown> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "user-agent": userAgent },
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return response.json();
}

/**
 * Reads JSON from a bridge's public API and parses it. A keyless endpoint answers a burst with a
 * rate-limit message instead, so a failed parse is waited out once.
 */
export async function readParsed<T>(schema: z.ZodType<T>, url: string, body?: object): Promise<T> {
  const first = schema.safeParse(await readJson(url, body));
  if (first.success) {
    return first.data;
  }
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  return schema.parse(await readJson(url, body));
}
