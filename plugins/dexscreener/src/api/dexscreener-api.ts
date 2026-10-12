import { BinferenceError, type Clock, type Http, type HttpResponse } from "@binference/plugin-sdk";
import { type DexBoost, readBoostList } from "./boost-answer.schema.js";
import { type DexPair, readPairList } from "./pair-answer.schema.js";
import {
  createRequestBudget,
  type EndpointGroup,
  rateLimited,
  type RequestBudget,
} from "./request-budget.js";

/** DEX Screener's public API, keyless: the reads the source makes. */
export interface DexscreenerApi {
  /** `GET /token-pairs/v1/{chainId}/{tokenAddress}`: the token's pools. */
  tokenPairs(
    chainId: string,
    tokenAddress: string,
    signal: AbortSignal,
  ): Promise<readonly DexPair[]>;
  /**
   * `GET /tokens/v1/{chainId}/{tokenAddresses}`: pairs of up to 30 tokens a request, the
   * documented most; a longer list is asked in parts, in order.
   */
  tokens(
    chainId: string,
    tokenAddresses: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly DexPair[]>;
  /** `GET /token-boosts/top/v1`: the tokens with the most active boosts, on every chain. */
  topBoosts(signal: AbortSignal): Promise<readonly DexBoost[]>;
}

/** What the API client is made from. */
export interface DexscreenerApiOptions {
  readonly http: Http;
  readonly clock: Clock;
  /** The longest a request waits for its turn under the rate limits. */
  readonly maxWaitMs: number;
}

const origin = "https://api.dexscreener.com";
/** The addresses `/tokens/v1` reads in one request, as its docs say. */
export const tokensPerRequest = 30;
// The published limits: 300 requests a minute on pairs and tokens, 60 on the boosts.
const windows = {
  pairs: { max: 300, windowMs: 60_000 },
  feeds: { max: 60, windowMs: 60_000 },
} as const;
// A 429 that names no wait pauses its group for the limits' whole window.
const defaultPauseMs = 60_000;
// The longest pause a Retry-After header may ask for.
const maxPauseMs = 300_000;

function unavailable(path: string, status: number): BinferenceError {
  return new BinferenceError({
    code: "dexscreener.unavailable",
    message: `DEX Screener's API gave no answer to ${path} (HTTP ${String(status)}).`,
    retryable: status === 408 || status >= 500,
    details: { status },
  });
}

function badAnswer(path: string): BinferenceError {
  return new BinferenceError({
    code: "dexscreener.bad_answer",
    message: `DEX Screener's answer to ${path} is outside its documented shape.`,
  });
}

/**
 * How long a 429 asks to wait: its Retry-After, in seconds or as an HTTP date, else the limits'
 * whole minute, at most five minutes.
 */
export function pauseOf(response: HttpResponse, nowMs: number): number {
  const header = response.headers["retry-after"]?.trim() ?? "";
  const asked = /^\d+$/.test(header) ? Number(header) * 1_000 : Date.parse(header) - nowMs;
  return Number.isFinite(asked) && asked >= 0 ? Math.min(asked, maxPauseMs) : defaultPauseMs;
}

// The path segment of a chain id or an address: only what DEX Screener's ids are made of.
function segment(text: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(text)) {
    throw new BinferenceError({
      code: "dexscreener.bad_request",
      message: "A DEX Screener path names something that is no chain id or address.",
    });
  }
  return text;
}

/** Where one documented read goes: its group of endpoints and its path. */
interface ReadTarget {
  readonly group: EndpointGroup;
  readonly path: string;
}

/** One documented read, with the schema its answer passes. */
interface Read<T> extends ReadTarget {
  readonly reader: (text: string) => T | undefined;
}

// Sends one read under the budget: a 429 pauses its group and the read goes once more.
function createReader(http: Http, clock: Clock, budget: RequestBudget) {
  const send = async (read: ReadTarget, signal: AbortSignal) => {
    await budget.take(read.group, signal);
    return await http.request({ method: "GET", url: `${origin}${read.path}`, signal });
  };
  const textOf = async (read: ReadTarget, signal: AbortSignal): Promise<string> => {
    const first = await send(read, signal);
    if (first.status === 429) {
      budget.pause(read.group, pauseOf(first, clock.now()));
    }
    const response = first.status === 429 ? await send(read, signal) : first;
    if (response.status === 429) {
      const pauseMs = pauseOf(response, clock.now());
      budget.pause(read.group, pauseMs);
      throw rateLimited(pauseMs);
    }
    if (response.status !== 200) {
      throw unavailable(read.path, response.status);
    }
    return response.body;
  };
  return async <T>(read: Read<T>, signal: AbortSignal): Promise<T> => {
    const answer = read.reader(await textOf(read, signal));
    if (answer === undefined) {
      throw badAnswer(read.path);
    }
    return answer;
  };
}

// The addresses in parts of at most one request's.
function partsOf(addresses: readonly string[]): readonly (readonly string[])[] {
  const count = Math.ceil(addresses.length / tokensPerRequest);
  return Array.from({ length: count }, (_part, index) =>
    addresses.slice(index * tokensPerRequest, (index + 1) * tokensPerRequest),
  );
}

/**
 * Creates the client of DEX Screener's public API. Each request waits its turn under the published
 * limits and carries the caller's signal. A 429 pauses that group of endpoints for its
 * Retry-After, or the whole minute when it names none, and the request is sent once more when its
 * turn comes within the longest wait; a second 429, or a turn further away, is a retryable
 * `dexscreener.rate_limited`. Any other status but 200 is `dexscreener.unavailable` (retryable for
 * 408 and 5xx), and a 200 outside the documented schema is `dexscreener.bad_answer`.
 */
export function createDexscreenerApi(options: DexscreenerApiOptions): DexscreenerApi {
  const { clock, maxWaitMs } = options;
  const budget = createRequestBudget({ clock, windows, maxWaitMs });
  const read = createReader(options.http, clock, budget);
  return {
    tokenPairs: async (chainId, tokenAddress, signal) =>
      read(
        {
          group: "pairs",
          path: `/token-pairs/v1/${segment(chainId)}/${segment(tokenAddress)}`,
          reader: readPairList,
        },
        signal,
      ),
    async tokens(chainId, tokenAddresses, signal) {
      const reads = partsOf(tokenAddresses.map(segment)).map((part) => ({
        group: "pairs" as const,
        path: `/tokens/v1/${segment(chainId)}/${part.join(",")}`,
        reader: readPairList,
      }));
      const answers = await Promise.all(reads.map(async (each) => read(each, signal)));
      return answers.flat();
    },
    topBoosts: async (signal) =>
      read({ group: "feeds", path: "/token-boosts/top/v1", reader: readBoostList }, signal),
  };
}
