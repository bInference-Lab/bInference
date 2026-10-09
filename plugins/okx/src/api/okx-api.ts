import { type Clock, err, type Http, ok, type Result } from "@binference/plugin-sdk";
import type { Address } from "viem";
import type { OkxKeys } from "../okx-options.js";
import { type AnswerReader, readEnvelope } from "./answer-envelope.schema.js";
import { answerFault, answerKindOf } from "./answer-fault.js";
import { type LiquiditySource, readLiquidityData } from "./liquidity-answer.schema.js";
import { type OkxRoute, readQuoteData } from "./route-answer.schema.js";
import { signedHeaders } from "./signed-headers.js";
import { type OkxSwap, readSwapData } from "./swap-answer.schema.js";

/** A route to quote: sell exactly `amountIn` of `tokenIn` for `tokenOut`. */
export interface RouteQuery {
  /** The chain's index in OKX's API, such as `56`. */
  readonly chainIndex: string;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  /** OKX's DEX ids the route must not use. */
  readonly excludedDexIds: readonly string[];
}

/** A quoted route to encode for a wallet. */
interface SwapOrder extends RouteQuery {
  /** The wallet that sends the call and receives the output. */
  readonly wallet: Address;
  /** The slippage OKX encodes its own minimum with, in percent, such as `0.5`. */
  readonly slippagePercent: string;
}

/** OKX's DEX aggregator API, called with the owner's key. */
export interface OkxApi {
  /** Quotes the best route. A pair or amount OKX cannot route is `no_route`. */
  quote(query: RouteQuery, signal: AbortSignal): Promise<Result<OkxRoute, "no_route">>;
  /** Quotes again and encodes the router call for a wallet. */
  swap(order: SwapOrder, signal: AbortSignal): Promise<Result<OkxSwap, "no_route">>;
  /** The liquidity protocols OKX routes through on a chain. */
  liquidity(chainIndex: string, signal: AbortSignal): Promise<readonly LiquiditySource[]>;
}

/** What the API client is made from. */
export interface OkxApiOptions {
  readonly http: Http;
  readonly clock: Clock;
  readonly keys: OkxKeys;
}

const origin = "https://web3.okx.com";
const aggregator = "/api/v6/dex/aggregator";

function routeParams(query: RouteQuery): URLSearchParams {
  const params = new URLSearchParams({
    chainIndex: query.chainIndex,
    amount: query.amountIn.toString(),
    fromTokenAddress: query.tokenIn.toLowerCase(),
    toTokenAddress: query.tokenOut.toLowerCase(),
  });
  if (query.excludedDexIds.length > 0) {
    params.set("excludeDexIds", query.excludedDexIds.join(","));
  }
  return params;
}

function swapParams(order: SwapOrder): URLSearchParams {
  const params = routeParams(order);
  params.set("slippagePercent", order.slippagePercent);
  params.set("userWalletAddress", order.wallet.toLowerCase());
  return params;
}

interface ApiCall<T> {
  readonly name: string;
  readonly path: string;
  readonly params: URLSearchParams;
  readonly read: AnswerReader<T>;
}

// A route OKX cannot find comes back as its code; every other refusal throws.
async function ask<T>(
  options: OkxApiOptions,
  call: ApiCall<T>,
  signal: AbortSignal,
): Promise<Result<T, string>> {
  const pathAndQuery = `${aggregator}${call.path}?${call.params.toString()}`;
  const headers = signedHeaders(options.keys, { pathAndQuery, atMs: options.clock.now() });
  const response = await options.http.request({
    method: "GET",
    url: `${origin}${pathAndQuery}`,
    headers,
    signal,
  });
  const envelope = readEnvelope(response.body);
  const isSuccess = response.status === 200 && envelope?.code === "0";
  const value = isSuccess ? call.read(envelope.data) : undefined;
  if (value !== undefined) {
    return ok(value);
  }
  const code = isSuccess ? undefined : envelope?.code;
  const kind = answerKindOf(response.status, code);
  if (kind === "no_route" && code !== undefined) {
    return err(code);
  }
  throw answerFault(kind === "no_route" ? "unavailable" : kind, {
    call: call.name,
    status: response.status,
    code,
  });
}

function noRoute<T>(answer: Result<T, string>): Result<T, "no_route"> {
  return answer.ok ? answer : err("no_route");
}

/**
 * Creates the client of OKX's DEX aggregator API. Every call is a GET signed with the owner's key
 * and stamped by the clock, and carries the caller's signal. A successful answer is checked by its
 * schema and read into the venue's own types. An answer code OKX documents as "no route" (too
 * little liquidity, an unsupported token, an amount out of range, a price impact past OKX's
 * protection) is `no_route`; every other refusal throws `okx.<kind>` with OKX's code, and an
 * answer that breaks its schema throws `okx.unavailable`.
 */
export function createOkxApi(options: OkxApiOptions): OkxApi {
  return {
    async quote(query, signal) {
      const params = routeParams(query);
      const call = { name: "a quote", path: "/quote", params, read: readQuoteData };
      return noRoute(await ask(options, call, signal));
    },
    async swap(order, signal) {
      const params = swapParams(order);
      const call = { name: "a swap", path: "/swap", params, read: readSwapData };
      return noRoute(await ask(options, call, signal));
    },
    async liquidity(chainIndex, signal) {
      const params = new URLSearchParams({ chainIndex });
      const call = {
        name: "a liquidity list",
        path: "/get-liquidity",
        params,
        read: readLiquidityData,
      };
      const sources = await ask(options, call, signal);
      if (!sources.ok) {
        throw answerFault("unavailable", { call: call.name, status: 200, code: sources.error });
      }
      return sources.value;
    },
  };
}
