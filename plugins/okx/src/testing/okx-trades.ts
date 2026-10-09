import type { HttpResponse } from "@binference/plugin-sdk";
import { buyPaths, dagCallData, nativeToken, salePaths, usdtToken } from "./dag-fixtures.js";
import { quoteAnswer, type RouteTerms, swapAnswer } from "./okx-answers.js";
import { okxRouter, okxUrl, quotedAtMs, walletAddress } from "./venue-fixtures.js";

// OKX's API writes a deadline an hour after it encodes the call; the host's is 60 s.
const okxDeadlineSec = BigInt(quotedAtMs / 1000 + 3_600);

function routeQuery(route: RouteTerms): Record<string, string> {
  return {
    chainIndex: "56",
    amount: route.amountIn.toString(),
    fromTokenAddress: route.tokenIn.toLowerCase(),
    toTokenAddress: route.tokenOut.toLowerCase(),
  };
}

/** 0.1 BNB to USDT through PancakeSwap v3, as OKX quotes it. */
export const buyRoute: RouteTerms = {
  tokenIn: nativeToken,
  tokenOut: usdtToken,
  amountIn: 10n ** 17n,
  amountOut: 74_200_000_000_000_000_000n,
  sources: ["PancakeSwap V3"],
};

/** 50 USDT to BNB through PancakeSwap v3, as OKX quotes it. */
export const sellRoute: RouteTerms = {
  tokenIn: usdtToken,
  tokenOut: nativeToken,
  amountIn: 50n * 10n ** 18n,
  amountOut: 67_300_000_000_000_000n,
  sources: ["PancakeSwap V3"],
};

/** The `/quote` request the venue sends for a route, with the DEX ids it excludes. */
export function quoteUrlOf(route: RouteTerms, excludedDexIds = ""): string {
  const query = routeQuery(route);
  return okxUrl(
    "/quote",
    excludedDexIds === "" ? query : { ...query, excludeDexIds: excludedDexIds },
  );
}

/** The `/swap` request the venue sends for a route at 0.5% slippage, for the fixtures' wallet. */
export function swapUrlOf(route: RouteTerms, excludedDexIds = ""): string {
  const query = routeQuery(route);
  const excluded = excludedDexIds === "" ? query : { ...query, excludeDexIds: excludedDexIds };
  return okxUrl("/swap", {
    ...excluded,
    slippagePercent: "0.50",
    userWalletAddress: walletAddress.toLowerCase(),
  });
}

/** OKX's quote of {@link buyRoute}. */
export const buyQuoteAnswer: HttpResponse = quoteAnswer(buyRoute);

/** OKX's quote of {@link sellRoute}. */
export const sellQuoteAnswer: HttpResponse = quoteAnswer(sellRoute);

/**
 * OKX's swap of {@link buyRoute} for the wallet: quoted again a little higher, a minimum 0.6%
 * under it, its own one-hour deadline, and `dagSwapByOrderId`, which pays the sender.
 */
export const buySwapAnswer: HttpResponse = swapAnswer(
  { ...buyRoute, amountOut: 74_250_000_000_000_000_000n },
  {
    from: walletAddress,
    to: okxRouter,
    value: 10n ** 17n,
    data: dagCallData({
      fromToken: nativeToken,
      toToken: usdtToken,
      amount: 10n ** 17n,
      minReturn: 73_804_500_000_000_000_000n,
      deadlineSec: okxDeadlineSec,
      paths: buyPaths,
    }),
    minReceiveAmount: 73_804_500_000_000_000_000n,
  },
);

/** OKX's swap of {@link sellRoute} for the wallet, with `dagSwapTo` naming the wallet. */
export const sellSwapAnswer: HttpResponse = swapAnswer(sellRoute, {
  from: walletAddress,
  to: okxRouter,
  value: 0n,
  data: dagCallData({
    fromToken: usdtToken,
    toToken: nativeToken,
    amount: 50n * 10n ** 18n,
    minReturn: 66_963_500_000_000_000n,
    deadlineSec: okxDeadlineSec,
    paths: salePaths,
    receiver: walletAddress,
  }),
  minReceiveAmount: 66_963_500_000_000_000n,
});
