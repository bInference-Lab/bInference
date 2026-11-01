import {
  err,
  type Http,
  type HttpResponse,
  type NoBridgeRoute,
  ok,
  type Result,
} from "@binference/plugin-sdk";
import type { Address, Hex } from "viem";
import { answerFault, answerKindOf, isNoRoute } from "./answer-fault.js";
import {
  type AcrossDepositAnswer,
  isDepositNotFound,
  readDepositAnswer,
} from "./status-answer.schema.js";
import { type AcrossSwap, isIndirectSwap, readSwapAnswer } from "./swap-answer.schema.js";

/** A direct bridge to quote: exactly `amount` of `inputToken`, from `depositor` to `recipient`. */
export interface SwapQuery {
  readonly originChainId: bigint;
  readonly destinationChainId: bigint;
  readonly inputToken: Address;
  /** The token the deposit names as arriving. */
  readonly outputToken: Address;
  /** What the API is asked for: the output token, or the zero address for the coin it wraps. */
  readonly askedOutput: Address;
  readonly amount: bigint;
  readonly depositor: Address;
  readonly recipient: Address;
}

/** Across's public API, as the bridge uses it. */
export interface AcrossApi {
  /**
   * Quotes a direct bridge with its encoded deposit. A route Across does not serve, or serves now
   * only with a swap on either side, is `no_route`; an amount outside its limits or liquidity names
   * which.
   */
  swap(query: SwapQuery, signal: AbortSignal): Promise<Result<AcrossSwap, NoBridgeRoute>>;
  /** Across's word on the deposit in this transaction; `unseen` until its indexer saw it. */
  deposit(hash: Hex, signal: AbortSignal): Promise<AcrossDepositAnswer | "unseen">;
}

const origin = "https://app.across.to/api";

/** The Swap API request the bridge makes for a query. */
export function swapUrlOf(query: SwapQuery): string {
  const params = new URLSearchParams({
    tradeType: "exactInput",
    amount: query.amount.toString(),
    inputToken: query.inputToken,
    outputToken: query.askedOutput,
    originChainId: query.originChainId.toString(),
    destinationChainId: query.destinationChainId.toString(),
    depositor: query.depositor,
    recipient: query.recipient,
    // A refund goes to the refund address, else to the recipient: it must be the wallet.
    refundAddress: query.depositor,
    refundOnOrigin: "true",
    // The engine simulates every step itself, and the wallet may not hold the input yet.
    skipOriginTxEstimation: "true",
  });
  return `${origin}/swap/approval?${params.toString()}`;
}

/** The deposit status request the bridge makes for a deposit's transaction. */
export function depositUrlOf(hash: Hex): string {
  return `${origin}/deposit/status?${new URLSearchParams({ depositTxnRef: hash }).toString()}`;
}

function failed(call: string, response: HttpResponse): Error {
  const kind = answerKindOf(response.status, response.body);
  return answerFault(isNoRoute(kind) ? "unavailable" : kind, { call, ...response });
}

/**
 * Creates the client of Across's API, keyless: the Swap API's `swap/approval` for a quote with its
 * deposit call, and `deposit/status` for a deposit's state, each with the caller's signal. Every
 * answer is checked by its schema and read into the bridge's own terms; an error code maps to no
 * route or to a fault that names it (`answer-fault.ts`), and an answer that breaks its schema is
 * `across.unavailable`.
 */
export function createAcrossApi(http: Http): AcrossApi {
  return {
    async swap(query, signal) {
      const response = await http.request({ method: "GET", url: swapUrlOf(query), signal });
      const answer = response.status === 200 ? readSwapAnswer(response.body) : undefined;
      if (answer !== undefined) {
        return ok(answer);
      }
      if (response.status === 200 && isIndirectSwap(response.body)) {
        return err("no_route");
      }
      const kind = answerKindOf(response.status, response.body);
      if (response.status !== 200 && isNoRoute(kind)) {
        return err(kind);
      }
      throw failed("a bridge quote", response);
    },
    async deposit(hash, signal) {
      const response = await http.request({ method: "GET", url: depositUrlOf(hash), signal });
      const answer = response.status === 200 ? readDepositAnswer(response.body) : undefined;
      if (answer !== undefined) {
        return answer;
      }
      if (response.status === 404 && isDepositNotFound(response.body)) {
        return "unseen";
      }
      throw failed("a deposit status request", response);
    },
  };
}
