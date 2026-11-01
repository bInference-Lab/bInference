import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { type Address, encodeFunctionData, erc20Abi, parseAbi } from "viem";

const swapAbi = parseAbi([
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

/** Buys `token` with `value` of the fork account's BNB on PancakeSwap's v2 router, for `to`. */
export async function buyFor(
  fork: Fork,
  purchase: { readonly token: Address; readonly to: Address; readonly value: bigint },
): Promise<void> {
  const data = encodeFunctionData({
    abi: swapAbi,
    functionName: "swapExactETHForTokens",
    args: [
      0n,
      [bscToken("WBNB"), purchase.token],
      purchase.to,
      BigInt(Math.floor(Date.now() / 1_000) + 600),
    ],
  });
  const router = bscContract("pancakeswap", "v2-router");
  await fork.send({ from: fork.account, to: router, value: purchase.value, data });
}

/** What an account holds on the fork of BNB and of a token. */
export async function heldOn(
  fork: Fork,
  account: { readonly address: Address; readonly token: Address },
): Promise<{ readonly coin: bigint; readonly token: bigint }> {
  const { address, token } = account;
  const [coin, held] = await Promise.all([
    fork.client.getBalance({ address }),
    fork.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);
  return { coin, token: held };
}
