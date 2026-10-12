import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
  type LaunchpadVenue,
  type QuoteRequest,
} from "@binference/plugin-sdk";
import type { RpcFailover, RpcReply } from "@binference/plugin-sdk/evm";
import { type Hex, parseEther, zeroAddress } from "viem";
import { z } from "zod";
import { createFlapVenue } from "../flap-venue.js";
import { quoteCallData, stateCallData } from "../portal/portal-calls.js";
import {
  buyHundredBnb,
  buyTenthBnb,
  buyTenUsdt,
  graduatedState,
  sellHundredThousand,
  sellMillion,
  taxTokenState,
  usdtNotFound,
  usdtTokenState,
} from "./recorded-portal.js";

/** BSC, the chain the answers were recorded on. */
export const bscChain: ChainRef = chainRefSchema.parse("eip155:56");

/** BNB, BSC's own coin. */
export const bnb: AssetRef = assetRefSchema.parse("eip155:56/slip44:714");

const portalAddress = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";
const usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
const taxTokenAddress = "0x7270576A906EAe19a995273695ec223056bD7777";
const usdtTokenAddress = "0x649216A8Bf562728fB5059a6BF842f7300C77777";
const graduatedAddress = "0x8344A74ABf9e31bFC9A4d0a2443826C768647777";

const erc20 = (address: string): AssetRef => assetRefSchema.parse(`${bscChain}/erc20:${address}`);

/** USDT on BSC, a quote token of Flap's curves. */
export const usdt: AssetRef = erc20(usdtAddress);

/** USD1 on BSC, a quote token of Flap's curves. */
export const usd1: AssetRef = erc20("0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d");

/** A token on its curve against BNB, with a 3% tax on each side. */
export const taxToken: AssetRef = erc20(taxTokenAddress);

/** A token on its curve against USDT: 1% tax on a buy, 2% on a sale. */
export const usdtToken: AssetRef = erc20(usdtTokenAddress);

/** A token that left its curve for a pool. */
export const graduatedToken: AssetRef = erc20(graduatedAddress);

/** The wallet the recorded trades are quoted for. */
export const recordedWallet: AccountRef = accountRefSchema.parse(
  `${bscChain}:0x000000000000000000000000000000000000bEEF`,
);

/** The venue's registry contracts on BSC, as the host gives them with a request. */
export const portalContracts: Readonly<Record<string, AccountRef>> = {
  portal: accountRefSchema.parse(`${bscChain}:${portalAddress}`),
};

/** One recorded answer of the Portal: a result, or a revert with its data. */
export type PortalAnswer = { readonly result: Hex } | { readonly revert: Hex };

/** An RPC failover that answers recorded `eth_call`s of the Portal, and keeps what it was asked. */
export interface ScriptedPortal extends RpcFailover {
  /** The calldata of each call, oldest first. */
  readonly asked: readonly Hex[];
}

const callSchema = z.tuple([
  z.object({ to: z.literal(portalAddress), data: z.templateLiteral(["0x", z.string()]) }),
  z.literal("latest"),
]);

const recorded = (amount: string) => parseEther(amount);

/** Every answer recorded on 2026-10-12, by the calldata that asked for it. */
export const recordedAnswers: ReadonlyMap<string, PortalAnswer> = new Map<string, PortalAnswer>([
  [stateCallData(taxTokenAddress), { result: taxTokenState }],
  [stateCallData(usdtTokenAddress), { result: usdtTokenState }],
  [stateCallData(graduatedAddress), { result: graduatedState }],
  [stateCallData(usdtAddress), { revert: usdtNotFound }],
  [
    quoteCallData({
      inputToken: zeroAddress,
      outputToken: taxTokenAddress,
      inputAmount: recorded("0.1"),
    }),
    { result: buyTenthBnb },
  ],
  [
    quoteCallData({
      inputToken: taxTokenAddress,
      outputToken: zeroAddress,
      inputAmount: recorded("1000000"),
    }),
    { result: sellMillion },
  ],
  [
    quoteCallData({
      inputToken: zeroAddress,
      outputToken: taxTokenAddress,
      inputAmount: recorded("100"),
    }),
    { result: buyHundredBnb },
  ],
  [
    quoteCallData({
      inputToken: usdtAddress,
      outputToken: usdtTokenAddress,
      inputAmount: recorded("10"),
    }),
    { result: buyTenUsdt },
  ],
  [
    quoteCallData({
      inputToken: usdtTokenAddress,
      outputToken: usdtAddress,
      inputAmount: recorded("100000"),
    }),
    { result: sellHundredThousand },
  ],
]);

function replyOf<T>(answer: PortalAnswer, result: z.ZodType<T>): RpcReply<T> {
  const endpoint = "recorded";
  return "result" in answer
    ? { kind: "result", endpoint, value: result.parse(answer.result) }
    : { kind: "error", endpoint, code: 3, message: "execution reverted", data: answer.revert };
}

/**
 * A failover that answers the Portal's `eth_call`s from `answers`, for tests. A call to another
 * contract, another method or calldata it holds no answer for throws, so a test never reads past
 * what was recorded.
 */
export function scriptedPortal(
  answers: ReadonlyMap<string, PortalAnswer> = recordedAnswers,
): ScriptedPortal {
  const asked: Hex[] = [];
  return {
    asked,
    async request(call) {
      call.signal.throwIfAborted();
      const [{ data }] = callSchema.parse(call.params);
      asked.push(data);
      const answer = call.method === "eth_call" ? answers.get(data) : undefined;
      if (answer === undefined) {
        throw new Error(`No recorded answer for ${call.method} ${data}.`);
      }
      return await Promise.resolve(replyOf(answer, call.result));
    },
    health: () => [],
  };
}

/** The Flap venue on BSC over a scripted Portal. */
export function venueOver(rpc: RpcFailover): LaunchpadVenue {
  return createFlapVenue({
    chains: [{ chain: bscChain, nativeAsset: bnb, quoteTokens: [usdt, usd1], rpc }],
  });
}

/** A quote request for the recorded wallet with the Portal, spending `amountIn` on `assetOut`. */
export function requestOf(amountIn: QuoteRequest["amountIn"], assetOut: AssetRef): QuoteRequest {
  return { wallet: recordedWallet, amountIn, assetOut, contracts: portalContracts };
}
