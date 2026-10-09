import { decimalStringSchema } from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { z } from "zod";

/** A route OKX's API quoted, read into the venue's own types. */
export interface OkxRoute {
  /** What the route sells, as OKX writes it: a token address or `0xEeee…EEeE`. */
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  /** What OKX expects the route to return, in base units of the token out. */
  readonly amountOut: bigint;
  /**
   * OKX's price impact in percent, as decimal text such as `"-0.12"`; a loss is negative. Absent
   * when OKX cannot tell it.
   */
  readonly priceImpactPercent?: string;
  /** The names of the liquidity protocols the route passes, each once, such as `PancakeSwap V3`. */
  readonly sources: readonly string[];
}

/** An EVM address in any letter case, read into its checksum form. */
export const okxAddressSchema: z.ZodType<Address, string> = z
  .string()
  .transform((text, context) => {
    const address = parseEvmAddress(text.toLowerCase());
    if (address.ok) {
      return address.value;
    }
    context.addIssue({ code: "custom", message: "Expected an EVM address." });
    return z.NEVER;
  });

const tokenSchema = z.looseObject({ tokenContractAddress: okxAddressSchema });

const hopSchema = z.looseObject({
  dexProtocol: z.looseObject({ dexName: z.string().min(1) }),
});

/** The route fields an answer of `/quote`, or the `routerResult` of `/swap`, carries. */
export const routeAnswerSchema: z.ZodType<OkxRoute> = z
  .looseObject({
    fromToken: tokenSchema,
    toToken: tokenSchema,
    fromTokenAmount: decimalStringSchema,
    toTokenAmount: decimalStringSchema,
    priceImpactPercent: z.string().nullish(),
    dexRouterList: z.array(hopSchema).min(1),
  })
  .transform((route) => ({
    tokenIn: route.fromToken.tokenContractAddress,
    tokenOut: route.toToken.tokenContractAddress,
    amountIn: route.fromTokenAmount,
    amountOut: route.toTokenAmount,
    ...(typeof route.priceImpactPercent === "string" && route.priceImpactPercent !== ""
      ? { priceImpactPercent: route.priceImpactPercent }
      : {}),
    sources: [...new Set(route.dexRouterList.map((hop) => hop.dexProtocol.dexName))],
  }));

/** Reads the first route of a successful `/quote` answer's data; anything else is undefined. */
export function readQuoteData(data: unknown): OkxRoute | undefined {
  const routes = z.array(routeAnswerSchema).min(1).safeParse(data);
  return routes.success ? routes.data[0] : undefined;
}
