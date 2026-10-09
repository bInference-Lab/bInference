import { evmAccountRef, createEvmReceiptReader } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { BinferenceError, type Http, type Id } from "@binference/core";
import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { buyIn, onFork, type Rig, usdt, walletKey } from "./executor-rig.js";
import { forkWallet } from "./fork-trading.js";
import { balanceOf, proposeAndTap, reach } from "./rig-actions.js";

// An Http whose first `failures` requests reach no host, as relays that are down would.
function flaky(http: Http, failures: number): Http {
  let left = failures;
  return {
    async request(request) {
      if (left > 0) {
        left -= 1;
        throw new BinferenceError({ code: "http.unreachable", message: "Down.", retryable: true });
      }
      return http.request(request);
    },
  };
}

// The wallet's one transaction and each relay's answers to its sends; a test without one fails.
async function sentOnce(rig: Rig, fork: Fork, signal: AbortSignal) {
  const account = evmAccountRef(fork.chain, forkWallet(walletKey).address);
  const query = { account, fromNonce: 0, limit: 10 };
  const [transaction, ...others] = await rig.stores.transactions.list(query, { signal });
  if (transaction === undefined || others.length > 0) {
    throw new BinferenceError({ code: "fork.not_one", message: "Expected one transaction." });
  }
  const answers = await rig.stores.transactions.sends(transaction.id, { signal });
  return { transaction, answers };
}

// The block that holds a stored transaction; one without a receipt reads as block 0.
function blockOf(transaction: {
  readonly receipt?: { readonly block: { readonly number: bigint } };
}) {
  return transaction.receipt?.block.number ?? 0n;
}

// The fork's own account buys USDT for the test wallet, which then holds it to sell.
async function fundUsdt(fork: Fork): Promise<bigint> {
  const to = forkWallet(walletKey).address;
  const data = encodeFunctionData({
    abi: parseAbi([
      "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
    ]),
    functionName: "swapExactETHForTokens",
    args: [0n, [bscToken("WBNB"), usdt], to, BigInt(Math.floor(Date.now() / 1_000) + 600)],
  });
  const router = bscContract("pancakeswap", "v2-router");
  await fork.send({ from: fork.account, to: router, value: 5n * 10n ** 16n, data });
  return balanceOf(fork);
}

// The intent's live execution; a test whose intent recorded none fails.
async function executionOf(rig: Rig, intent: Id<"int">, signal: AbortSignal) {
  const query = { isPaper: false, after: 0, limit: 10 };
  const executions = await rig.positions.executions(query, { signal });
  const execution = executions.find(({ intentId }) => intentId === intent);
  if (execution === undefined) {
    throw new BinferenceError({ code: "fork.no_execution", message: "Nothing was recorded." });
  }
  return execution;
}

describe("the executor on the BSC fork", () => {
  it("ends a confirmed swap reconciled, its raw bytes stored before the first send", async ({
    signal,
  }) => {
    await onFork(signal, {}, async (rig, fork) => {
      const before = await balanceOf(fork);
      const intent = await proposeAndTap(rig, signal);
      await expect(reach(rig, intent, "reconciled")).resolves.toBe("reconciled");
      const { transaction, answers } = await sentOnce(rig, fork, signal);
      expect(transaction.state).toBe("final");
      const [first] = rig.sends;
      expect(first?.raw).toBe(transaction.raw);
      expect(first?.stored).toStrictEqual([transaction.raw]);
      expect(rig.custody.signatures()).toBe(1);
      const onChain = await fork.call("eth_getTransactionByHash", [transaction.hash]);
      expect(onChain).toMatchObject({ hash: transaction.hash });
      const after = await balanceOf(fork);
      expect(after).toBeGreaterThan(before);
      const query = { isPaper: false, after: 0, limit: 10 };
      const [execution, ...others] = await rig.positions.executions(query, { signal });
      expect(others).toStrictEqual([]);
      expect(execution).toMatchObject({
        intentId: intent,
        sold: { asset: rig.native, base: buyIn },
        bought: { asset: rig.bought, base: after - before },
        txHash: transaction.hash,
      });
      expect(execution?.gas.base).toBeGreaterThan(0n);
      const finality = { kind: "finalized_tag" } as const;
      const reader = createEvmReceiptReader({ rpc: fork.rpc, chain: fork.chain, finality });
      const block = blockOf(transaction);
      await expect(reader.nonceAt(transaction.account, block, { signal })).resolves.toBe(1);
      await expect(reader.nonceAt(transaction.account, block - 1n, { signal })).resolves.toBe(0);
      expect(answers.map(({ relay }) => relay)).toStrictEqual(["anvil-a", "anvil-b"]);
      expect(answers.map(({ outcome }) => outcome)).toContain("accepted");
    });
  });

  it("reconciles a sale of USDT for BNB, the BNB received matching the chain", async ({
    signal,
  }) => {
    await onFork(signal, {}, async (rig, fork) => {
      const held = await fundUsdt(fork);
      const address = forkWallet(walletKey).address;
      const before = await fork.client.getBalance({ address });
      const sale = { from: rig.bought, to: rig.native, base: held };
      const intent = await proposeAndTap(rig, signal, sale);
      await expect(reach(rig, intent, "reconciled")).resolves.toBe("reconciled");
      const after = await fork.client.getBalance({ address });
      const execution = await executionOf(rig, intent, signal);
      expect(execution.sold).toStrictEqual({ asset: rig.bought, base: held });
      expect(execution.bought.asset).toBe(rig.native);
      expect(execution.bought.base).toBe(after - before + execution.gas.base);
      expect(execution.bought.base).toBeGreaterThan(0n);
      expect(await balanceOf(fork)).toBe(0n);
      expect(rig.custody.signatures()).toBe(2);
    });
  });

  it("sends the same stored bytes again after a failed send, and never signs again", async ({
    signal,
  }) => {
    await onFork(signal, { relayHttp: (http) => flaky(http, 2) }, async (rig, fork) => {
      const intent = await proposeAndTap(rig, signal);
      await expect(reach(rig, intent, "reconciled")).resolves.toBe("reconciled");
      expect(rig.custody.signatures()).toBe(1);
      const { transaction, answers } = await sentOnce(rig, fork, signal);
      expect(rig.sends.map(({ raw }) => raw).slice(0, 2)).toStrictEqual([
        transaction.raw,
        transaction.raw,
      ]);
      expect(answers.slice(0, 2).map(({ outcome }) => outcome)).toStrictEqual([
        "unreachable",
        "unreachable",
      ]);
      expect(answers.slice(2).map(({ outcome }) => outcome)).toContain("accepted");
    });
  });
});
