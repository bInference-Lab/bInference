import { bsc } from "@binference/chains";
import { createManualClock } from "@binference/core/testing";
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  keccak256,
  parseAbi,
  slice,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { evmChainOf } from "../evm-chain.js";
import { createEvmClient } from "../rpc/create-evm-client.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { addressSchema, hexSchema, quantitySchema } from "../rpc/evm-wire.schema.js";
import { type JsonValue, jsonValueSchema } from "../rpc/json-value.schema.js";
import { simulate } from "../simulation/simulate.js";
import { readTransfers } from "../simulation/transfer-logs.js";
import { createLoopbackHttp } from "../testing/loopback-http.js";

// Set by the fork suite once anvil serves a BSC fork on loopback; pnpm check never sets it.
// oxlint-disable-next-line node/no-process-env -- the fork suite's switch, read only here
const forkRpc = process.env["BINFERENCE_FORK_RPC"] ?? "";

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

const chain = evmChainOf(bsc);
const http = createLoopbackHttp();
const signal = new AbortController().signal;
const amountIn = 10n ** 17n;

function registryAddress(found: { readonly address: string } | undefined): Address {
  return getAddress(found?.address ?? "");
}

const router = registryAddress(
  bsc.contracts.find((item) => item.venue === "pancakeswap" && item.name === "v2-router"),
);
const wbnb = registryAddress(bsc.tokens.find((item) => item.symbol === "WBNB"));
const usdt = registryAddress(bsc.tokens.find((item) => item.symbol === "USDT"));
// A fresh address: no code on BSC, so no EIP-7702 delegate forwards its BNB on the fork.
const trader = getAddress(slice(keccak256(toHex("binference fork trader")), 12));

// The router's quote for the last hop of a path.
function outputOf(amounts: readonly bigint[]): bigint {
  return amounts.at(-1) ?? 0n;
}

// anvil's own methods and sends go straight to the fork; the failover refuses sends.
async function anvil(method: string, params: readonly JsonValue[]): Promise<JsonValue> {
  const response = await http.request({
    method: "POST",
    url: forkRpc,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  return z.object({ result: jsonValueSchema }).parse(JSON.parse(response.body)).result;
}

const receiptSchema = z.object({
  status: quantitySchema,
  logs: z.array(z.object({ address: addressSchema, topics: z.array(hexSchema), data: hexSchema })),
});

async function receiptOf(
  hash: JsonValue,
  attemptsLeft = 100,
): Promise<z.output<typeof receiptSchema>> {
  const receipt = await anvil("eth_getTransactionReceipt", [hash]);
  if (receipt === null && attemptsLeft > 0) {
    return receiptOf(hash, attemptsLeft - 1);
  }
  return receiptSchema.parse(receipt);
}

describe.runIf(forkRpc !== "")("simulation on a BSC fork", () => {
  it("returns the transfers of a PancakeSwap v2 swap, as the swap's receipt shows them", async () => {
    const rpc = createRpcFailover({
      endpoints: [{ name: "anvil-fork", url: forkRpc }],
      http,
      clock: createManualClock(),
      timeoutMs: 120_000,
      restMs: 1,
    });
    const viem = createEvmClient({ chain, rpc, signal });
    const path = [wbnb, usdt] as const;
    const quote = outputOf(
      await viem.readContract({
        address: router,
        abi: routerAbi,
        functionName: "getAmountsOut",
        args: [amountIn, path],
      }),
    );
    const { timestamp } = await viem.getBlock();
    const data: Hex = encodeFunctionData({
      abi: routerAbi,
      functionName: "swapExactETHForTokens",
      args: [(quote * 99n) / 100n, path, trader, timestamp + 300n],
    });

    const simulation = await simulate(rpc, {
      chain,
      calls: [{ from: trader, to: router, value: amountIn, data }],
      balances: [{ address: trader, balanceWei: 10n ** 18n }],
      signal,
    });

    const [call] = simulation.calls;
    expect(call?.status).toBe("success");
    expect(quote).toBeGreaterThan(0n);
    expect(call?.transfers).toContainEqual({
      from: `${chain.ref}:${trader}`,
      to: `${chain.ref}:${router}`,
      amount: { asset: chain.nativeAsset, base: amountIn },
    });
    const received = call?.transfers.filter((item) => item.to === `${chain.ref}:${trader}`);
    expect(received?.map((item) => item.amount)).toStrictEqual([
      { asset: `${chain.ref}/erc20:${usdt}`, base: quote },
    ]);

    // The same swap, sent for real on the fork, moves the same tokens.
    await anvil("anvil_setCode", [trader, "0x"]);
    await anvil("anvil_setBalance", [trader, toHex(10n ** 18n)]);
    await anvil("anvil_impersonateAccount", [trader]);
    await anvil("evm_setAutomine", [false]);
    const hash = await anvil("eth_sendTransaction", [
      { from: trader, to: router, value: toHex(amountIn), data, gas: toHex(400_000n) },
    ]);
    await anvil("evm_mine", []);
    const receipt = await receiptOf(hash);
    expect(receipt.status).toBe(1n);
    const tokenTransfers = call?.transfers.filter(
      (item) => item.amount.asset !== chain.nativeAsset,
    );
    expect(readTransfers(chain, receipt.logs)).toStrictEqual(tokenTransfers);
  }, 120_000);
});
