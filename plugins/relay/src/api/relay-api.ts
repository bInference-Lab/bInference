import {
  type Clock,
  err,
  type Http,
  type HttpResponse,
  type NoBridgeRoute,
  ok,
  type Result,
  type Secret,
} from "@binference/plugin-sdk";
import type { Hex } from "viem";
import {
  answerFault,
  answerKindOf,
  isNoRoute,
  isPassingAnswer,
  unansweredFault,
} from "./answer-fault.js";
import { type RelayQuote, readQuoteAnswer } from "./quote-answer.schema.js";
import { type RelayRequest, readRequestsAnswer } from "./request-answer.schema.js";

/**
 * A quote request as Relay's `POST /quote/v2` takes it: exactly `amount` of `originCurrency`
 * from `user` to `recipient`, refunded on the origin chain to `refundTo`, with the order data, no
 * slippage and a time to live in seconds.
 */
export interface QuoteBody {
  readonly user: string;
  readonly recipient: string;
  readonly originChainId: number;
  readonly destinationChainId: number;
  readonly originCurrency: string;
  readonly destinationCurrency: string;
  readonly amount: string;
  readonly tradeType: "EXACT_INPUT";
  readonly refundTo: string;
  readonly refundOnOrigin: true;
  readonly includeProtocolData: true;
  readonly slippageTolerance: "0";
  readonly ttl: number;
}

/** Relay's public API, as the bridge uses it. */
export interface RelayApi {
  /**
   * Quotes a bridge with its order and deposit. A route Relay does not serve is `no_route`; an
   * amount outside its limits or its solvers' liquidity names which.
   */
  quote(body: QuoteBody, signal: AbortSignal): Promise<Result<RelayQuote, NoBridgeRoute>>;
  /** The requests a deposit's transaction paid into; none until Relay saw it. */
  requests(hash: Hex, signal: AbortSignal): Promise<readonly RelayRequest[]>;
}

const origin = "https://api.relay.link";

/** How long the client waits before it asks for a quote again after a passing fault. */
export const quoteRetryMs = 1_000;

/** What the client of Relay's API is made from. */
export interface RelayApiParts {
  readonly http: Http;
  /** Waits out the pause before a quote is asked again. */
  readonly clock: Clock;
  /** The owner's key, sent as `x-api-key` on every request when there is one. */
  readonly key?: Secret;
}

/** The quote request's URL. */
export const quoteUrl: string = `${origin}/quote/v2`;

/**
 * The requests read for a deposit's transaction: version 3 by `depositTxHash` with a key, which
 * version 3 needs; else version 2 by `hash`, which Relay answers without one until it retires it
 * on 2026-11-24 (decision 0322).
 */
export function requestsUrlOf(hash: Hex, by: { readonly keyed: boolean }): string {
  return by.keyed
    ? `${origin}/requests/v3?${new URLSearchParams({ depositTxHash: hash }).toString()}`
    : `${origin}/requests/v2?${new URLSearchParams({ hash }).toString()}`;
}

// Requests version 2 answers 404 or 410 once Relay retired it: only a key, for version 3, reads
// deposits again.
const isRetired = (response: HttpResponse): boolean =>
  response.status === 404 || response.status === 410;

/**
 * Creates the client of Relay's API: `POST /quote/v2` for a quote with its order and deposit, and
 * the requests endpoint for where a deposit stands, each with the caller's signal and the owner's
 * key as `x-api-key` when there is one. Every answer is checked by its schema and read into the
 * bridge's own terms; an error code maps to no route or to a fault that names it
 * (`answer-fault.ts`), and an answer that breaks its schema is `relay.unavailable`. A quote whose
 * answer names a code Relay's errors guide calls passing is asked once more after a pause; a quote
 * has no side effect, so the second ask moves nothing.
 */
export function createRelayApi(parts: RelayApiParts): RelayApi {
  const { http, clock, key } = parts;
  // The key is revealed only into the header of the request that sends it.
  const keyHeaders = (): Readonly<Record<string, string>> =>
    key === undefined ? {} : { "x-api-key": key.reveal() };
  const askQuote = async (body: QuoteBody, signal: AbortSignal): Promise<HttpResponse> =>
    http.request({
      method: "POST",
      url: quoteUrl,
      headers: { "content-type": "application/json", ...keyHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  return {
    async quote(body, signal) {
      const first = await askQuote(body, signal);
      const isPassing = first.status !== 200 && isPassingAnswer(first.body);
      if (isPassing) {
        await clock.sleep(quoteRetryMs, signal);
      }
      const response = isPassing ? await askQuote(body, signal) : first;
      const answer = response.status === 200 ? readQuoteAnswer(response.body) : undefined;
      if (answer !== undefined) {
        return ok(answer);
      }
      const kind = answerKindOf(response.status, response.body);
      if (response.status !== 200 && isNoRoute(kind)) {
        return err(kind);
      }
      throw unansweredFault("a bridge quote", response);
    },
    async requests(hash, signal) {
      const url = requestsUrlOf(hash, { keyed: key !== undefined });
      const response = await http.request({ method: "GET", url, headers: keyHeaders(), signal });
      const answer = response.status === 200 ? readRequestsAnswer(response.body) : undefined;
      if (answer !== undefined) {
        return answer;
      }
      if (key === undefined && isRetired(response)) {
        throw answerFault("unauthorized", { call: "a deposit status request", ...response });
      }
      throw unansweredFault("a deposit status request", response);
    },
  };
}
