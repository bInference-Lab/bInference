import type { Clock, Http } from "@binference/plugin-sdk";
import { createPacedReader, pathSegment } from "@binference/plugin-sdk/data";
import { type GeckoOhlcv, readOhlcv } from "./ohlcv-answer.schema.js";
import { type GeckoPool, readPoolList } from "./pool-answer.schema.js";
import { readTokenPrices } from "./token-answer.schema.js";

/** The documented timeframes of the OHLCV endpoint. */
export type OhlcvTimeframe = "minute" | "hour" | "day";

/** Which candles of which pool to read. */
export interface OhlcvQuery {
  /** GeckoTerminal's id of the pool's network, such as `bsc`. */
  readonly network: string;
  /** The pool's address or id. */
  readonly pool: string;
  readonly timeframe: OhlcvTimeframe;
  /** The candle width in timeframes: 1, 5 or 15 minutes, 1, 4 or 12 hours, or 1 day. */
  readonly aggregate: number;
  /** The candles before this time, in seconds since the epoch; up to now when absent. */
  readonly beforeTimestamp?: number;
  /** How many candles, at most {@link candlesPerRequest}. */
  readonly limit: number;
  /** The token whose USD price the candles show: its address, so the chart is never inverted. */
  readonly token: string;
}

/** GeckoTerminal's public API, keyless: the reads the source makes. */
export interface GeckoterminalApi {
  /** `GET /networks/{network}/tokens/{token_address}/pools`: the token's top pools; none for a 404. */
  tokenPools(
    network: string,
    tokenAddress: string,
    signal: AbortSignal,
  ): Promise<readonly GeckoPool[]>;
  /** `GET /networks/{network}/trending_pools`: the network's trending pools, in its order. */
  trendingPools(network: string, signal: AbortSignal): Promise<readonly GeckoPool[]>;
  /**
   * `GET /networks/{network}/pools/{pool_address}/ohlcv/{timeframe}`, in USD, every interval, the
   * pool and token in lowercase as GeckoTerminal writes them.
   */
  ohlcv(query: OhlcvQuery, signal: AbortSignal): Promise<GeckoOhlcv>;
  /**
   * `GET /networks/{network}/tokens/multi/{addresses}`: up to 30 tokens a request, the
   * documented most; a longer list is asked in parts, in order. Prices by lowercase address.
   */
  tokenPrices(
    network: string,
    tokenAddresses: readonly string[],
    signal: AbortSignal,
  ): Promise<ReadonlyMap<string, string>>;
}

/** What the API client is made from. */
export interface GeckoterminalApiOptions {
  readonly http: Http;
  readonly clock: Clock;
  /** The longest a request waits for its turn under the rate limit. */
  readonly maxWaitMs: number;
}

/** The candles one OHLCV request reads at most, as its docs say. */
export const candlesPerRequest = 1_000;
/** The addresses one request for several tokens reads at most, as its docs say. */
export const pricesPerRequest = 30;

/**
 * GeckoTerminal's public API: about 10 calls a minute for every endpoint together, as its docs
 * publish, and the API version they ask callers to set in `Accept`.
 */
const service = {
  id: "geckoterminal",
  name: "GeckoTerminal",
  origin: "https://api.geckoterminal.com/api/v2",
  headers: { accept: "application/json;version=20230203" },
  limits: { all: { max: 10, windowMs: 60_000 } },
} as const;

const segment = (text: string): string => pathSegment(service.id, text);

// The addresses in parts of at most one request's.
function partsOf(addresses: readonly string[]): readonly (readonly string[])[] {
  const count = Math.ceil(addresses.length / pricesPerRequest);
  return Array.from({ length: count }, (_part, index) =>
    addresses.slice(index * pricesPerRequest, (index + 1) * pricesPerRequest),
  );
}

// The OHLCV query string: USD, every interval with the empty ones filled, for the token asked.
function ohlcvParams(query: OhlcvQuery): string {
  const params = new URLSearchParams({
    aggregate: String(query.aggregate),
    limit: String(Math.min(query.limit, candlesPerRequest)),
    currency: "usd",
    token: segment(query.token).toLowerCase(),
    include_empty_intervals: "true",
  });
  if (query.beforeTimestamp !== undefined) {
    params.set("before_timestamp", String(query.beforeTimestamp));
  }
  return params.toString();
}

/**
 * Creates the client of GeckoTerminal's public API. Each request waits its turn under the
 * published limit and carries the caller's signal and the API version. A 429 pauses every
 * endpoint for its Retry-After, or the whole minute when it names none, and the request is sent
 * once more when its turn comes within the longest wait; a second 429, or a turn further away, is
 * a retryable `geckoterminal.rate_limited`. A token's pools answer none for the documented 404 of
 * an unknown token. Any other status but 200 is `geckoterminal.unavailable` (retryable for 408 and
 * 5xx), and a 200 outside the documented schema is `geckoterminal.bad_answer`.
 */
export function createGeckoterminalApi(options: GeckoterminalApiOptions): GeckoterminalApi {
  const read = createPacedReader({ ...options, service });
  return {
    tokenPools: async (network, tokenAddress, signal) =>
      read(
        {
          group: "all",
          path: `/networks/${segment(network)}/tokens/${segment(tokenAddress)}/pools`,
          reader: readPoolList,
          notFound: [],
        },
        signal,
      ),
    trendingPools: async (network, signal) =>
      read(
        {
          group: "all",
          path: `/networks/${segment(network)}/trending_pools`,
          reader: readPoolList,
        },
        signal,
      ),
    ohlcv: async (query, signal) =>
      read(
        {
          group: "all",
          path: `/networks/${segment(query.network)}/pools/${segment(query.pool).toLowerCase()}/ohlcv/${query.timeframe}?${ohlcvParams(query)}`,
          reader: readOhlcv,
        },
        signal,
      ),
    async tokenPrices(network, tokenAddresses, signal) {
      const reads = partsOf(tokenAddresses.map(segment)).map((part) => ({
        group: "all" as const,
        path: `/networks/${segment(network)}/tokens/multi/${part.join(",")}`,
        reader: readTokenPrices,
      }));
      const answers = await Promise.all(reads.map(async (each) => read(each, signal)));
      const prices = new Map<string, string>();
      for (const answer of answers) {
        for (const [address, price] of answer) {
          prices.set(address, price);
        }
      }
      return prices;
    },
  };
}
