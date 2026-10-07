import {
  BinferenceError,
  err,
  type Http,
  type HttpResponse,
  ok,
  type Result,
} from "@binference/plugin-sdk";
import type { Address } from "viem";
import { type BuiltRoute, readBuildAnswer } from "./build-answer.schema.js";
import { readErrorCode } from "./error-answer.schema.js";
import { parseJsonText } from "./json-text.schema.js";
import { type FoundRoute, readRouteAnswer } from "./route-answer.schema.js";

/** A route to find: spend exactly `amountIn` of `tokenIn` on `tokenOut`. */
export interface RouteQuery {
  /** The chain's name in the API's path, such as `bsc`. */
  readonly slug: string;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  /** KyberSwap's DEX ids the route must not use. */
  readonly excludedSources: readonly string[];
}

/** A found route to encode for a wallet. */
interface BuildOrder {
  readonly slug: string;
  /** The route summary as {@link FoundRoute.summary} holds it. */
  readonly summary: string;
  /** The wallet that sends the call and receives the output. */
  readonly wallet: Address;
  /** Unix seconds; the call reverts after it. */
  readonly deadlineSec: number;
  /** The slippage the API encodes its own minimum with, in basis points. */
  readonly slippageBps: number;
}

/** KyberSwap's public aggregator API, keyless. */
export interface KyberswapApi {
  /** Finds the best route. A pair or amount KyberSwap cannot route is `no_route`. */
  findRoute(query: RouteQuery, signal: AbortSignal): Promise<Result<FoundRoute, "no_route">>;
  /** Encodes a found route's router call for a wallet. */
  buildRoute(order: BuildOrder, signal: AbortSignal): Promise<BuiltRoute>;
}

/** What the API client is made from. */
export interface KyberswapApiOptions {
  readonly http: Http;
  readonly clientId: string;
}

const origin = "https://aggregator-api.kyberswap.com";
// Route not found, amount above the maximum, no eligible pool, unknown token, and every source
// filtered out: KyberSwap's answers for a trade it has no route for.
const noRouteCodes: ReadonlySet<number> = new Set([4008, 4009, 4010, 4011, 40011]);

function failed(call: string, response: HttpResponse): BinferenceError {
  const status = response.status;
  return new BinferenceError({
    code: "kyberswap.unavailable",
    message: `KyberSwap's API gave no usable answer to ${call} (HTTP ${String(status)}).`,
    retryable: status === 429 || status >= 500,
    details: { status, answer: readErrorCode(response.body) ?? "none" },
  });
}

function routesUrl(query: RouteQuery): string {
  const params = new URLSearchParams({
    tokenIn: query.tokenIn,
    tokenOut: query.tokenOut,
    amountIn: query.amountIn.toString(),
  });
  if (query.excludedSources.length > 0) {
    params.set("excludedSources", query.excludedSources.join(","));
  }
  return `${origin}/${query.slug}/api/v1/routes?${params.toString()}`;
}

function buildBody(order: BuildOrder, source: string): string {
  return JSON.stringify({
    routeSummary: parseJsonText(order.summary),
    sender: order.wallet,
    recipient: order.wallet,
    deadline: order.deadlineSec,
    slippageTolerance: order.slippageBps,
    source,
  });
}

/**
 * Creates the client of KyberSwap's aggregator API. Every call names binference with the client
 * id and carries the caller's signal. Each answer is checked by its schema and read into the
 * venue's own types; an answer that breaks it, or an error other than "no route", throws
 * `kyberswap.unavailable`.
 */
export function createKyberswapApi(options: KyberswapApiOptions): KyberswapApi {
  const { http, clientId } = options;
  const headers = { "x-client-id": clientId };
  return {
    async findRoute(query, signal) {
      const response = await http.request({
        method: "GET",
        url: routesUrl(query),
        headers,
        signal,
      });
      const found = response.status === 200 ? readRouteAnswer(response.body) : undefined;
      if (found !== undefined) {
        return ok(found);
      }
      if (response.status === 400 && noRouteCodes.has(readErrorCode(response.body) ?? 0)) {
        return err("no_route");
      }
      throw failed("a route request", response);
    },
    async buildRoute(order, signal) {
      const response = await http.request({
        method: "POST",
        url: `${origin}/${order.slug}/api/v1/route/build`,
        headers: { ...headers, "content-type": "application/json" },
        body: buildBody(order, clientId),
        signal,
      });
      const built = response.status === 200 ? readBuildAnswer(response.body) : undefined;
      if (built === undefined) {
        throw failed("a build request", response);
      }
      return built;
    },
  };
}
