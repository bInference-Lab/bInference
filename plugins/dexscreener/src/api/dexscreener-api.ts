import type { Clock, Http } from "@binference/plugin-sdk";
import { createPacedReader, pathSegment } from "@binference/plugin-sdk/data";
import { type DexBoost, readBoostList } from "./boost-answer.schema.js";
import { type DexPair, readPairList } from "./pair-answer.schema.js";

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

/** The addresses `/tokens/v1` reads in one request, as its docs say. */
export const tokensPerRequest = 30;

/**
 * DEX Screener's API and its two published limits: 300 requests a minute on the pairs, tokens,
 * token pairs and search endpoints (`pairs`), and 60 a minute on the profiles, boosts, orders,
 * takeovers, ads and metas (`feeds`).
 */
const service = {
  id: "dexscreener",
  name: "DEX Screener",
  origin: "https://api.dexscreener.com",
  limits: {
    pairs: { max: 300, windowMs: 60_000 },
    feeds: { max: 60, windowMs: 60_000 },
  },
} as const;

const segment = (text: string): string => pathSegment(service.id, text);

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
  const read = createPacedReader({ ...options, service });
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
