import { encodeFunctionData, parseAbi, parseAbiItem } from "viem";
import { describe, expect, inject, it } from "vitest";
import { bscContract, bscToken } from "./bsc-addresses.js";
import { callLoopback } from "./call-loopback.js";
import { withFork } from "./with-fork.js";

const factoryAbi = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
]);
const pairAbi = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);
const wbnbAbi = parseAbi(["function deposit() payable"]);
const sync = parseAbiItem("event Sync(uint112 reserve0, uint112 reserve1)");
const deposit = parseAbiItem("event Deposit(address indexed dst, uint256 wad)");

const factory = bscContract("pancakeswap", "v2-factory");
const wbnb = bscToken("WBNB");
const usdt = bscToken("USDT");
// Two calls to the logs node; BSC's busiest PancakeSwap v2 pair trades many times in that span.
const historyBlocks = 400n;

describe("scanLogs", () => {
  it("reads history through the logs node, in step with the fork's state", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const { block, client } = fork;
      const pair = await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "getPair",
        args: [wbnb, usdt],
      });

      const logs = await fork.scanLogs({
        address: pair,
        event: sync,
        fromBlock: block - historyBlocks + 1n,
        toBlock: block,
      });

      const [reserve0, reserve1] = await client.readContract({
        address: pair,
        abi: pairAbi,
        functionName: "getReserves",
      });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((log) => log.blockNumber <= block)).toBe(true);
      expect(logs.at(-1)?.args).toStrictEqual({ reserve0, reserve1 });
    }));

  it("reads the blocks mined on the fork from anvil, after the history", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const { account, block } = fork;
      const wad = 10n ** 18n;
      const receipt = await fork.send({
        from: account,
        to: wbnb,
        value: wad,
        data: encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" }),
      });

      const logs = await fork.scanLogs({
        address: wbnb,
        event: deposit,
        fromBlock: block - 9n,
        toBlock: receipt.blockNumber,
      });

      expect(receipt.blockNumber).toBe(block + 1n);
      expect(logs.filter((log) => log.blockNumber > block)).toStrictEqual([
        expect.objectContaining({
          transactionHash: receipt.transactionHash,
          args: { dst: account, wad },
        }),
      ]);
    }));

  it("refuses all but reads at the logs node, so no fork test can send to BSC", async ({
    signal,
  }) => {
    const send = { rpcUrl: inject("fork").logsRpcUrl, method: "eth_sendRawTransaction" };
    await expect(callLoopback({ ...send, params: ["0x02"] }, signal)).rejects.toThrow(
      "The logs node forwards eth_getLogs, eth_blockNumber, eth_chainId only.",
    );
  });
});
