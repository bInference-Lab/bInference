import { encodeFunctionData, erc20Abi, getAddress, type Hex, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { simulate } from "../simulation/simulate.js";
import { readTransfers } from "../simulation/transfer-logs.js";
import { bscContract, bscToken } from "./bsc-addresses.js";
import type { Fork } from "./open-fork.js";
import { withFork } from "./with-fork.js";

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

const router = bscContract("pancakeswap", "v2-router");
const usdt = bscToken("USDT");
const path = [bscToken("WBNB"), usdt] as const;
const amountIn = 10n ** 17n;

interface Swap {
  readonly quote: bigint;
  readonly data: Hex;
}

// 0.1 BNB to USDT for the test account, with the router's quote at the fork block and a 1%
// minimum out.
async function swapOf(fork: Fork): Promise<Swap> {
  const amounts = await fork.client.readContract({
    address: router,
    abi: routerAbi,
    functionName: "getAmountsOut",
    args: [amountIn, path],
  });
  const quote = amounts.at(-1) ?? 0n;
  const { timestamp } = await fork.client.getBlock();
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactETHForTokens",
    args: [(quote * 99n) / 100n, path, fork.account, timestamp + 300n],
  });
  return { quote, data };
}

async function usdtOf(fork: Fork): Promise<bigint> {
  return fork.client.readContract({
    address: usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [fork.account],
  });
}

describe("simulation on a BSC fork", () => {
  it("returns the transfers of a PancakeSwap v2 swap, as the swap's receipt shows them", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const { account, chain } = fork;
      const { quote, data } = await swapOf(fork);
      const call = { from: account, to: router, value: amountIn, data };

      const simulation = await simulate(fork.rpc, { chain, calls: [call], signal });

      const [simulated] = simulation.calls;
      expect(simulated?.status).toBe("success");
      expect(quote).toBeGreaterThan(0n);
      expect(simulated?.transfers).toContainEqual({
        from: `${chain.ref}:${account}`,
        to: `${chain.ref}:${router}`,
        amount: { asset: chain.nativeAsset, base: amountIn },
      });
      const received = simulated?.transfers.filter((item) => item.to === `${chain.ref}:${account}`);
      expect(received?.map((item) => item.amount)).toStrictEqual([
        { asset: `${chain.ref}/erc20:${usdt}`, base: quote },
      ]);

      // The same swap, sent on the fork, moves the same tokens and pays exactly the quote.
      const usdtBefore = await usdtOf(fork);
      const receipt = await fork.send(call);
      expect(receipt.status).toBe("success");
      // anvil gives addresses in lowercase; chain-evm reads logs in checksum form.
      const logs = receipt.logs.map(({ address, topics, data: logData }) => ({
        address: getAddress(address),
        topics,
        data: logData,
      }));
      expect(readTransfers(chain, logs)).toStrictEqual(
        simulated?.transfers.filter((item) => item.amount.asset !== chain.nativeAsset),
      );
      await expect(usdtOf(fork)).resolves.toBe(usdtBefore + quote);
    }));
});
