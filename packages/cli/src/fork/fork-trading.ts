import {
  type AccountRef,
  type AssetRef,
  type BuildRequest,
  type Signer,
  type TxDraft,
  type Venue,
  accountRefParts,
} from "@binference/chain";
import {
  decodeEvmDraft,
  decodeEvmTransaction,
  encodeEvmDraft,
  erc20AssetRef,
  evmAccountRef,
} from "@binference/chain-evm";
import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { bpsSchema, err, type Id, ok } from "@binference/core";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
]);
const router = bscContract("pancakeswap", "v2-router");
const wbnb = bscToken("WBNB");

/** The test wallet: a key made from fixed words, so no key is written down anywhere. */
export function forkWallet(key: `0x${string}`): ReturnType<typeof privateKeyToAccount> {
  return privateKeyToAccount(key);
}

// A token's address from its asset reference; BNB itself trades as WBNB on the v2 router.
function tokenOf(asset: AssetRef, nativeAsset: AssetRef): Address {
  return asset === nativeAsset ? wbnb : getAddress(asset.split(":").at(-1) ?? "");
}

function pathOf(trade: Pick<BuildRequest, "amountIn" | "assetOut">, nativeAsset: AssetRef) {
  return [tokenOf(trade.amountIn.asset, nativeAsset), tokenOf(trade.assetOut, nativeAsset)];
}

// A sale of a token for BNB: the exact approval to the router, then `swapExactTokensForETH`.
function saleDrafts(fork: Fork, request: BuildRequest, nativeAsset: AssetRef): readonly TxDraft[] {
  const { chain } = fork;
  const token = tokenOf(request.amountIn.asset, nativeAsset);
  const approve = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [router, request.amountIn.base],
  });
  const swap = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactTokensForETH",
    args: [
      request.amountIn.base,
      request.minOut.base,
      pathOf(request, nativeAsset),
      getAddress(accountRefParts(request.wallet).address),
      BigInt(Math.floor(request.deadlineMs / 1_000)),
    ],
  });
  const from = request.wallet;
  return [
    encodeEvmDraft({ from, to: evmAccountRef(chain, token), value: 0n, data: approve }),
    encodeEvmDraft({ from, to: evmAccountRef(chain, router), value: 0n, data: swap }),
  ];
}

function buyDrafts(fork: Fork, request: BuildRequest, nativeAsset: AssetRef): readonly TxDraft[] {
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactETHForTokens",
    args: [
      request.minOut.base,
      pathOf(request, nativeAsset),
      getAddress(accountRefParts(request.wallet).address),
      BigInt(Math.floor(request.deadlineMs / 1_000)),
    ],
  });
  const to = evmAccountRef(fork.chain, router);
  return [encodeEvmDraft({ from: request.wallet, to, value: request.amountIn.base, data })];
}

/**
 * A venue for the fork suite on PancakeSwap's v2 router: it quotes with `getAmountsOut` on the
 * fork, buys a token with `swapExactETHForTokens`, sells one for BNB with an exact approval and
 * `swapExactTokensForETH`, and its decoder reads both trade calls back.
 */
export function pancakeV2Venue(fork: Fork, nativeAsset: AssetRef): Venue {
  const { chain, client } = fork;
  return {
    id: "pancakeswap",
    contracts: [{ chain: chain.ref, names: ["v2-router"] }],
    async quote(request) {
      const amounts = await client.readContract({
        address: router,
        abi: routerAbi,
        functionName: "getAmountsOut",
        args: [request.amountIn.base, pathOf(request, nativeAsset)],
      });
      const out = amounts.at(-1) ?? 0n;
      const expectedOut = { asset: request.assetOut, base: out };
      return out === 0n ? err("no_route") : ok({ expectedOut, priceImpactBps: bpsSchema.parse(5) });
    },
    async build(request) {
      const isSale = request.amountIn.asset !== nativeAsset;
      return Promise.resolve(
        isSale ? saleDrafts(fork, request, nativeAsset) : buyDrafts(fork, request, nativeAsset),
      );
    },
    decode: (draft) => decodeSwap(fork, nativeAsset, draft),
  };
}

function assetOf(fork: Fork, token: Address, nativeAsset: AssetRef): AssetRef {
  return token === wbnb ? nativeAsset : erc20AssetRef(fork.chain, token);
}

function decodeSwap(fork: Fork, nativeAsset: AssetRef, draft: TxDraft) {
  const call = decodeEvmDraft(draft);
  if (!call.ok) {
    return err("unknown_call");
  }
  const decoded = decodeFunctionData({ abi: routerAbi, data: call.value.data });
  if (decoded.functionName === "swapExactETHForTokens") {
    const [minOut, path, to, deadline] = decoded.args;
    return ok({
      recipient: evmAccountRef(fork.chain, to),
      amountIn: { asset: nativeAsset, base: call.value.value },
      minOut: { asset: assetOf(fork, path.at(-1) ?? wbnb, nativeAsset), base: minOut },
      deadlineMs: Number(deadline) * 1_000,
    });
  }
  if (decoded.functionName === "swapExactTokensForETH") {
    const [amountIn, minOut, path, to, deadline] = decoded.args;
    return ok({
      recipient: evmAccountRef(fork.chain, to),
      amountIn: { asset: assetOf(fork, path[0] ?? wbnb, nativeAsset), base: amountIn },
      minOut: { asset: nativeAsset, base: minOut },
      deadlineMs: Number(deadline) * 1_000,
    });
  }
  return err("unknown_call");
}

/**
 * Custody for the fork suite: one wallet whose key signs here, as a custodian signs in its
 * enclave. It refuses a transaction whose sender is not the wallet's account.
 */
export function forkCustody(
  wallet: Id<"wal">,
  account: AccountRef,
  key: `0x${string}`,
): Signer & { readonly signatures: () => number } {
  const signer = forkWallet(key);
  let signatures = 0;
  return {
    async account(asked, chain, { signal }) {
      signal.throwIfAborted();
      const isOwn = asked === wallet && accountRefParts(account).chain === chain;
      return Promise.resolve(isOwn ? ok(account) : err("unknown_wallet"));
    },
    async signTransaction(request, { signal }) {
      signal.throwIfAborted();
      if (request.wallet !== wallet) {
        return err("unknown_wallet");
      }
      const tx = decodeEvmTransaction(request.tx);
      if (request.tx.from !== account || !tx.ok) {
        return err("refused");
      }
      signatures += 1;
      const { chainId, nonce, gas, fees, to, value, data } = tx.value;
      const raw = await signer.signTransaction({
        type: "eip1559",
        chainId,
        nonce,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        to,
        value,
        data,
      });
      return ok({ chain: request.tx.chain, raw });
    },
    signatures: () => signatures,
  };
}
