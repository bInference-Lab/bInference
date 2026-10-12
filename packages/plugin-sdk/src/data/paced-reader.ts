import { BinferenceError, type Clock, type Http, type HttpResponse } from "@binference/core";
import { type CallWindow, createRequestBudget } from "./request-budget.js";

/** A keyless data service a data source reads, and the limits it publishes. */
export interface PacedService<Group extends string> {
  /** The plugin's id, which names its faults, such as `dexscreener.rate_limited`. */
  readonly id: string;
  /** The service's name in a fault's message, such as `DEX Screener`. */
  readonly name: string;
  /** Where its API answers, such as `https://api.dexscreener.com`, without a trailing slash. */
  readonly origin: string;
  /** Headers every request carries, such as the API version the service's docs ask for. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Each group of endpoints and the limit the service publishes for it. */
  readonly limits: Readonly<Record<Group, CallWindow>>;
}

/** What a {@link PacedReader} is made from. */
export interface PacedReaderOptions<Group extends string> {
  readonly http: Http;
  readonly clock: Clock;
  readonly service: PacedService<Group>;
  /** The longest a request waits for its turn, a 429's pause included, before it fails. */
  readonly maxWaitMs: number;
}

/** Where one read goes: its group of endpoints and its path. */
interface ReadTarget<Group extends string> {
  readonly group: Group;
  /** The path after the origin, its segments made with {@link pathSegment}. */
  readonly path: string;
}

/** One documented read: its group of endpoints, its path and the schema its answer passes. */
export interface PacedRead<T, Group extends string> extends ReadTarget<Group> {
  /** Reads the answer's text; an answer outside the documented shape is undefined. */
  readonly reader: (text: string) => T | undefined;
  /** What a 404 means where the docs give it a meaning, such as no pools; else a 404 fails. */
  readonly notFound?: T;
}

/** Sends one documented read and answers what its schema read. */
export type PacedReader<Group extends string> = <T>(
  read: PacedRead<T, Group>,
  signal: AbortSignal,
) => Promise<T>;

// The longest pause a Retry-After header may ask for.
const maxPauseMs = 300_000;

/**
 * How long a 429 asks to wait: its Retry-After, in seconds or as an HTTP date, else `defaultMs`,
 * at most five minutes.
 */
export function pauseOf(response: HttpResponse, nowMs: number, defaultMs: number): number {
  const header = response.headers["retry-after"]?.trim() ?? "";
  const asked = /^\d+$/.test(header) ? Number(header) * 1_000 : Date.parse(header) - nowMs;
  return Number.isFinite(asked) && asked >= 0 ? Math.min(asked, maxPauseMs) : defaultMs;
}

/**
 * One segment of a request path, such as a chain id or an address: only letters, digits and
 * `._:-`, so nothing a caller passes can change the path. Anything else is a `<id>.bad_request`
 * fault, thrown before any request goes.
 */
export function pathSegment(id: string, text: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(text)) {
    throw new BinferenceError({
      code: `${id}.bad_request`,
      message: `A ${id} request path names something that is no id or address.`,
    });
  }
  return text;
}

function faultsOf(service: { readonly id: string; readonly name: string }) {
  return {
    rateLimited: (retryAfterMs: number) =>
      new BinferenceError({
        code: `${service.id}.rate_limited`,
        message: `${service.name}'s rate limit holds this request back.`,
        retryable: true,
        details: { retryAfterMs },
      }),
    unavailable: (path: string, status: number) =>
      new BinferenceError({
        code: `${service.id}.unavailable`,
        message: `${service.name}'s API gave no answer to ${path} (HTTP ${String(status)}).`,
        retryable: status === 408 || status >= 500,
        details: { status },
      }),
    badAnswer: (path: string) =>
      new BinferenceError({
        code: `${service.id}.bad_answer`,
        message: `${service.name}'s answer to ${path} is outside its documented shape.`,
      }),
  };
}

/**
 * Creates the reader of a keyless data service's documented endpoints. Each request waits its
 * turn under the published limit of its group, counting every request sent, retries included, and
 * carries the caller's signal. A 429 pauses that group for its Retry-After, or the group's whole
 * window when it names none, and the request goes once more when its turn comes within the
 * longest wait; a second 429, or a turn further away, is a retryable `<id>.rate_limited` with
 * `details.retryAfterMs`. A 404 answers the read's `notFound` when it has one. Any other status but
 * 200 is `<id>.unavailable` (retryable for 408 and 5xx, `details.status`), and a 200 outside the
 * documented schema is `<id>.bad_answer`.
 */
export function createPacedReader<Group extends string>(
  options: PacedReaderOptions<Group>,
): PacedReader<Group> {
  const { http, clock, service, maxWaitMs } = options;
  const faults = faultsOf(service);
  const budget = createRequestBudget({
    clock,
    windows: service.limits,
    maxWaitMs,
    tooLong: faults.rateLimited,
  });
  const headers = service.headers === undefined ? {} : { headers: service.headers };
  const send = async (read: ReadTarget<Group>, signal: AbortSignal) => {
    await budget.take(read.group, signal);
    const url = `${service.origin}${read.path}`;
    return await http.request({ method: "GET", url, ...headers, signal });
  };
  const pauseFor = (read: ReadTarget<Group>, response: HttpResponse): number => {
    const pauseMs = pauseOf(response, clock.now(), service.limits[read.group].windowMs);
    budget.pause(read.group, pauseMs);
    return pauseMs;
  };
  const answerOf = async (read: ReadTarget<Group>, signal: AbortSignal) => {
    const first = await send(read, signal);
    if (first.status !== 429) {
      return first;
    }
    pauseFor(read, first);
    const second = await send(read, signal);
    if (second.status === 429) {
      throw faults.rateLimited(pauseFor(read, second));
    }
    return second;
  };
  return async <T>(read: PacedRead<T, Group>, signal: AbortSignal): Promise<T> => {
    const response = await answerOf(read, signal);
    if (response.status === 404 && read.notFound !== undefined) {
      return read.notFound;
    }
    if (response.status !== 200) {
      throw faults.unavailable(read.path, response.status);
    }
    const answer = read.reader(response.body);
    if (answer === undefined) {
      throw faults.badAnswer(read.path);
    }
    return answer;
  };
}
