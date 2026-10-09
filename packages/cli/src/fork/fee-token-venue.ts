import {
  accountRefParts,
  accountRefSchema,
  type AssetRef,
  assetRefParts,
  type BuildRequest,
  type DecodedEffect,
  type TxDraft,
  type Venue,
} from "@binference/chain";
import {
  decodeEvmDraft,
  encodeEvmDraft,
  erc20AssetRef,
  evmAccountRef,
} from "@binference/chain-evm";
import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { bpsSchema, err, ok, type Result } from "@binference/core";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  parseAbi,
} from "viem";

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);
const router = bscContract("pancakeswap", "v2-router");
const wbnb = bscToken("WBNB");

function addressOf(asset: AssetRef): Address {
  return getAddress(assetRefParts(asset).assetReference);
}

/** What the fork venue routes: the BNB pair of tokens it trades through another token. */
export interface FeeTokenVenueOptions {
  readonly fork: Fork;
  /** BNB as the fork's chain names it. */
  readonly nativeAsset: AssetRef;
  /** A token whose PancakeSwap v2 pair is against another token, such as USDT: its route token. */
  readonly via: ReadonlyMap<AssetRef, Address>;
}

/**
 * A venue for the fork suite that trades BNB for a token and back on PancakeSwap's v2 router with
 * the calls that support a token that takes a fee on transfer. It quotes with `getAmountsOut`,
 * which knows no fee, and builds the exact approval before a sale. Its decoder reads both calls
 * back for the venue host.
 */
export function createFeeTokenVenue(options: FeeTokenVenueOptions): Venue {
  const { fork, nativeAsset, via } = options;
  const pathOf = (token: AssetRef): readonly Address[] => {
    const middle = via.get(token);
    return middle === undefined ? [wbnb, addressOf(token)] : [wbnb, middle, addressOf(token)];
  };
  const isBuy = (request: { readonly amountIn: { readonly asset: AssetRef } }): boolean =>
    request.amountIn.asset === nativeAsset;
  return {
    id: "pancakeswap",
    contracts: [{ chain: fork.chain.ref, names: ["v2-router"] }],
    async quote(request) {
      const token = isBuy(request) ? request.assetOut : request.amountIn.asset;
      const path = isBuy(request) ? pathOf(token) : pathOf(token).toReversed();
      const amounts = await fork.client.readContract({
        address: router,
        abi: routerAbi,
        functionName: "getAmountsOut",
        args: [request.amountIn.base, path],
      });
      const out = amounts.at(-1) ?? 0n;
      const expectedOut = { asset: request.assetOut, base: out };
      return out === 0n ? err("no_route") : ok({ expectedOut, priceImpactBps: bpsSchema.parse(5) });
    },
    async build(request) {
      return Promise.resolve(
        isBuy(request) ? [buyDraft(request, pathOf)] : saleDrafts(request, pathOf),
      );
    },
    decode: (draft) => decodeSwap(fork, { nativeAsset, draft }),
  };
}

function walletOf(request: BuildRequest): Address {
  return getAddress(accountRefParts(request.wallet).address);
}

function deadlineOf(request: BuildRequest): bigint {
  return BigInt(Math.floor(request.deadlineMs / 1_000));
}

// A call from the wallet to `target` on the wallet's chain: the router, or the token it sells.
function callDraft(
  request: BuildRequest,
  call: { readonly target: Address; readonly value: bigint; readonly data: Hex },
): TxDraft {
  const { target, value, data } = call;
  const to = accountRefSchema.parse(`${accountRefParts(request.wallet).chain}:${target}`);
  return encodeEvmDraft({ from: request.wallet, to, value, data });
}

function buyDraft(request: BuildRequest, pathOf: (token: AssetRef) => readonly Address[]): TxDraft {
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: [request.minOut.base, pathOf(request.assetOut), walletOf(request), deadlineOf(request)],
  });
  return callDraft(request, { target: router, value: request.amountIn.base, data });
}

function saleDrafts(
  request: BuildRequest,
  pathOf: (token: AssetRef) => readonly Address[],
): readonly TxDraft[] {
  const allowance = [router, request.amountIn.base] as const;
  const approval = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: allowance });
  const target = addressOf(request.amountIn.asset);
  const approve = callDraft(request, { target, value: 0n, data: approval });
  const path = pathOf(request.amountIn.asset).toReversed();
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
    args: [
      request.amountIn.base,
      request.minOut.base,
      path,
      walletOf(request),
      deadlineOf(request),
    ],
  });
  return [approve, callDraft(request, { target: router, value: 0n, data })];
}

function decodeSwap(
  fork: Fork,
  call: { readonly nativeAsset: AssetRef; readonly draft: TxDraft },
): Result<DecodedEffect, "unknown_call"> {
  const decoded = decodeEvmDraft(call.draft);
  if (!decoded.ok) {
    return err("unknown_call");
  }
  const { chain } = fork;
  const swap = decodeFunctionData({ abi: routerAbi, data: decoded.value.data });
  if (swap.functionName === "swapExactETHForTokensSupportingFeeOnTransferTokens") {
    const [minOut, path, to, deadline] = swap.args;
    return ok({
      recipient: evmAccountRef(chain, to),
      amountIn: { asset: call.nativeAsset, base: decoded.value.value },
      minOut: { asset: erc20AssetRef(chain, path.at(-1) ?? wbnb), base: minOut },
      deadlineMs: Number(deadline) * 1_000,
    });
  }
  if (swap.functionName === "swapExactTokensForETHSupportingFeeOnTransferTokens") {
    const [amountIn, minOut, path, to, deadline] = swap.args;
    return ok({
      recipient: evmAccountRef(chain, to),
      amountIn: { asset: erc20AssetRef(chain, path[0] ?? wbnb), base: amountIn },
      minOut: { asset: call.nativeAsset, base: minOut },
      deadlineMs: Number(deadline) * 1_000,
    });
  }
  return err("unknown_call");
}
