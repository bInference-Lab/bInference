import type { HttpResponse } from "@binference/plugin-sdk";
import type { Address, Hex } from "viem";
import { answer } from "./venue-fixtures.js";

/** A route in the shape OKX's `/quote` answer and `/swap` router result write it. */
export interface RouteTerms {
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  /** The protocols each hop names, such as `PancakeSwap V3`. */
  readonly sources: readonly string[];
  readonly priceImpactPercent?: string | null;
}

function tokenOf(address: Address, symbol: string): object {
  return {
    decimal: "18",
    isHoneyPot: false,
    taxRate: "0",
    tokenContractAddress: address.toLowerCase(),
    tokenSymbol: symbol,
    tokenUnitPrice: null,
  };
}

/** The route fields of an answer, as OKX's Get Quotes reference lists them. */
function routeFields(route: RouteTerms): object {
  return {
    chainIndex: "56",
    swapMode: "exactIn",
    dexRouterList: route.sources.map((dexName, index) => ({
      dexProtocol: { dexName, percent: "100" },
      fromToken: tokenOf(route.tokenIn, "IN"),
      fromTokenIndex: String(index),
      toToken: tokenOf(route.tokenOut, "OUT"),
      toTokenIndex: String(index + 1),
    })),
    estimateGasFee: "210000",
    fromToken: tokenOf(route.tokenIn, "IN"),
    fromTokenAmount: route.amountIn.toString(),
    priceImpactPercent: route.priceImpactPercent === undefined ? "-0.05" : route.priceImpactPercent,
    router: `${route.tokenIn.toLowerCase()}--${route.tokenOut.toLowerCase()}`,
    toToken: tokenOf(route.tokenOut, "OUT"),
    toTokenAmount: route.amountOut.toString(),
    tradeFee: "0.0123",
  };
}

/** A successful `/quote` answer for one route. */
export function quoteAnswer(route: RouteTerms): HttpResponse {
  return answer({ code: "0", data: [routeFields(route)], msg: "" });
}

/** The router call of a `/swap` answer. */
export interface SwapTx {
  readonly from: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  readonly minReceiveAmount: bigint;
}

/** A successful `/swap` answer, as OKX's Swap reference lists its fields. */
export function swapAnswer(route: RouteTerms, tx: SwapTx): HttpResponse {
  return answer({
    code: "0",
    data: [
      {
        routerResult: routeFields(route),
        tx: {
          data: tx.data,
          from: tx.from.toLowerCase(),
          gas: "315000",
          gasPrice: "100000000",
          maxPriorityFeePerGas: "100000000",
          maxSpendAmount: "",
          minReceiveAmount: tx.minReceiveAmount.toString(),
          signatureData: [],
          slippagePercent: "0.5",
          to: tx.to.toLowerCase(),
          value: tx.value.toString(),
        },
      },
    ],
    msg: "",
  });
}

/** A successful `/get-liquidity` answer listing protocols by DEX id and name. */
export function liquidityAnswer(
  sources: readonly (readonly [id: string, name: string])[],
): HttpResponse {
  const data = sources.map(([id, name]) => ({ id, logo: "https://static.okx.com/logo.png", name }));
  return answer({ code: "0", data, msg: "" });
}

/** An answer OKX gives instead of a result: its code, with the HTTP status its list names. */
export function errorAnswer(code: string, status = 200): HttpResponse {
  return answer({ code, data: [], msg: "An answer text the venue never shows." }, status);
}
