import {
  type AccountRef,
  type AssetRef,
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
import { type Address, decodeFunctionData, encodeFunctionData, getAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const router = bscContract("pancakeswap", "v2-router");
const wbnb = bscToken("WBNB");

/** The test wallet: a key made from fixed words, so no key is written down anywhere. */
export function forkWallet(key: `0x${string}`): ReturnType<typeof privateKeyToAccount> {
  return privateKeyToAccount(key);
}

/**
 * A venue for the fork suite that buys a token with BNB on PancakeSwap's v2 router: it quotes with
 * `getAmountsOut` on the fork and builds `swapExactETHForTokens`, which its decoder reads back.
 */
// BNB, wrapped, to the token: the asset's reference is the token's address.
function pathTo(asset: AssetRef): readonly Address[] {
  return [wbnb, getAddress(asset.split(":").at(-1) ?? "")];
}

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
        args: [request.amountIn.base, pathTo(request.assetOut)],
      });
      const out = amounts.at(-1) ?? 0n;
      const expectedOut = { asset: request.assetOut, base: out };
      return out === 0n ? err("no_route") : ok({ expectedOut, priceImpactBps: bpsSchema.parse(5) });
    },
    async build(request) {
      const data = encodeSwap(request.minOut.base, pathTo(request.assetOut), {
        to: getAddress(accountRefParts(request.wallet).address),
        deadline: BigInt(Math.floor(request.deadlineMs / 1_000)),
      });
      const to = evmAccountRef(chain, router);
      return Promise.resolve([
        encodeEvmDraft({ from: request.wallet, to, value: request.amountIn.base, data }),
      ]);
    },
    decode: (draft) => decodeSwap(fork, nativeAsset, draft),
  };
}

function encodeSwap(
  minOut: bigint,
  path: readonly Address[],
  call: { readonly to: Address; readonly deadline: bigint },
): `0x${string}` {
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactETHForTokens",
    args: [minOut, path, call.to, call.deadline],
  });
}

function decodeSwap(fork: Fork, nativeAsset: AssetRef, draft: TxDraft) {
  const call = decodeEvmDraft(draft);
  if (!call.ok) {
    return err("unknown_call");
  }
  const decoded = decodeFunctionData({ abi: routerAbi, data: call.value.data });
  if (decoded.functionName !== "swapExactETHForTokens") {
    return err("unknown_call");
  }
  const [minOut, path, to, deadline] = decoded.args;
  const token = path.at(-1) ?? router;
  return ok({
    recipient: evmAccountRef(fork.chain, to),
    amountIn: { asset: nativeAsset, base: call.value.value },
    minOut: { asset: erc20AssetRef(fork.chain, token), base: minOut },
    deadlineMs: Number(deadline) * 1_000,
  });
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
