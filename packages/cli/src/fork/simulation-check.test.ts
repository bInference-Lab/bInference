import type { Amount, TxDraft, TxSimulator } from "@binference/chain";
import {
  createEvmTxSimulator,
  encodeEvmDraft,
  erc20AssetRef,
  evmAccountRef,
} from "@binference/chain-evm";
import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { bpsSchema, idSchema, type Result } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { BuiltQuote, SimulatedSteps, Simulator } from "@binference/engine";
import { checkEffects, createSimulationCheck } from "@binference/engine/simulation";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  keccak256,
  maxUint256,
  parseAbi,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { fakeRouterCode } from "./fake-router.js";

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
]);
const allowanceAbi = parseAbi([
  "function increaseAllowance(address spender, uint256 addedValue) returns (bool)",
]);

const router = bscContract("pancakeswap", "v2-router");
const wbnb = bscToken("WBNB");
const usdt = bscToken("USDT");
// Addresses no contract on BSC holds: a stranger, and two routers the tests install on the fork.
const addressOf = (name: string): Address => getAddress(keccak256(toHex(name)).slice(0, 42));
const thief = addressOf("binference fork thief");
// A wallet with nothing on the chain, as a paper agent's often is.
const emptyWallet = addressOf("binference fork paper wallet");
const relay = addressOf("binference fork relay router");
const skimmer = addressOf("binference fork skimming router");

const intent = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000046");
const nowMs = Date.UTC(2026, 9, 7);
const buyIn = 10n ** 17n;
const saleIn = 10n * 10n ** 18n;

/** One test's fork, the EVM simulator over it, and the simulation check over that. */
interface Bench {
  readonly fork: Fork;
  readonly simulator: TxSimulator;
  readonly check: Simulator;
}

function benchOf(fork: Fork): Bench {
  const simulator = createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain });
  const clock = createManualClock(nowMs);
  const check = createSimulationCheck({ simulator, chains: selfHostedChains(), clock });
  return { fork, simulator, check };
}

function draft(
  fork: Fork,
  call: {
    readonly to: Address;
    readonly data: Hex;
    readonly value?: bigint;
    readonly from?: Address;
  },
): TxDraft {
  const { chain, account } = fork;
  return encodeEvmDraft({
    from: evmAccountRef(chain, call.from ?? account),
    to: evmAccountRef(chain, call.to),
    value: call.value ?? 0n,
    data: call.data,
  });
}

async function quoteOf(fork: Fork, amountIn: bigint, path: readonly Address[]): Promise<bigint> {
  const amounts = await fork.client.readContract({
    address: router,
    abi: routerAbi,
    functionName: "getAmountsOut",
    args: [amountIn, path],
  });
  return amounts.at(-1) ?? 0n;
}

async function deadlineOf(fork: Fork): Promise<bigint> {
  const { timestamp } = await fork.client.getBlock();
  return timestamp + 600n;
}

// The quote a venue would give for the plan: its input, the router's output, 1% slippage.
function builtOf(amountIn: Amount, expectedOut: Amount, steps: readonly TxDraft[]): BuiltQuote {
  const quotedAt = nowMs;
  return {
    quote: {
      route: [{ venue: "pancakeswap", shareBps: bpsSchema.parse(10_000) }],
      amountIn,
      expectedOut,
      minOut: { asset: expectedOut.asset, base: (expectedOut.base * 99n) / 100n },
      priceImpactBps: bpsSchema.parse(0),
      gas: { asset: amountIn.asset, base: 0n },
      quotedAt,
      expiresAt: quotedAt + 60_000,
    },
    steps,
  };
}

/** A buy of USDT with 0.1 BNB through `via`, which passes the call on to PancakeSwap's router. */
async function buyThrough(bench: Bench, via: Address): Promise<BuiltQuote> {
  const { fork } = bench;
  const quote = await quoteOf(fork, buyIn, [wbnb, usdt]);
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactETHForTokens",
    args: [(quote * 99n) / 100n, [wbnb, usdt], fork.account, await deadlineOf(fork)],
  });
  return builtOf(
    { asset: fork.chain.nativeAsset, base: buyIn },
    { asset: erc20AssetRef(fork.chain, usdt), base: quote },
    [draft(fork, { to: via, data, value: buyIn })],
  );
}

// Sends real transactions on the fork: the wallet buys USDT with 0.5 BNB, so it holds some.
async function holdUsdt(fork: Fork): Promise<void> {
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactETHForTokens",
    args: [0n, [wbnb, usdt], fork.account, await deadlineOf(fork)],
  });
  const receipt = await fork.send({ from: fork.account, to: router, value: 5n * buyIn, data });
  expect(receipt.status).toBe("success");
}

async function approveOnChain(fork: Fork, spender: Address): Promise<void> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, maxUint256],
  });
  const receipt = await fork.send({ from: fork.account, to: usdt, data });
  expect(receipt.status).toBe("success");
}

function boundsOf(bench: Bench, built: BuiltQuote) {
  const chain = selfHostedChains().get(bench.fork.chain.ref);
  if (!chain.ok) {
    throw new Error("The registry has no BSC.");
  }
  const { amountIn, minOut } = built.quote;
  const wallet = evmAccountRef(bench.fork.chain, bench.fork.account);
  return { wallet, amountIn, minOut, approvals: [], family: chain.value.family };
}

// The gas a simulation that passed measured; a refusal fails the test.
function gasOf(simulated: Result<SimulatedSteps, string>): bigint {
  if (!simulated.ok) {
    throw new Error(`Expected a simulation, got ${simulated.error}.`);
  }
  return simulated.value.gasUsed;
}

describe("simulation check on a BSC fork", () => {
  it("passes a PancakeSwap buy that spends exactly the input, receives the quote and uses gas", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork);
      const built = await buyThrough(bench, router);

      const simulated = await bench.check.simulate(intent, built, { signal });

      expect(simulated).toStrictEqual({
        ok: true,
        value: {
          spent: [built.quote.amountIn],
          received: [built.quote.expectedOut],
          simulatedAt: nowMs,
          gasUsed: gasOf(simulated),
        },
      });
      expect(gasOf(simulated)).toBeGreaterThan(21_000n);
    }));

  it("passes a PancakeSwap sale with its exact approval, which the swap spends to zero", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork);
      await holdUsdt(fork);
      const quote = await quoteOf(fork, saleIn, [usdt, wbnb]);
      const approve = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [router, saleIn],
      });
      const sell = encodeFunctionData({
        abi: routerAbi,
        functionName: "swapExactTokensForETH",
        args: [saleIn, (quote * 99n) / 100n, [usdt, wbnb], fork.account, await deadlineOf(fork)],
      });
      const built = builtOf(
        { asset: erc20AssetRef(fork.chain, usdt), base: saleIn },
        { asset: fork.chain.nativeAsset, base: quote },
        [draft(fork, { to: usdt, data: approve }), draft(fork, { to: router, data: sell })],
      );

      await expect(bench.check.simulate(intent, built, { signal })).resolves.toMatchObject({
        ok: true,
        value: { spent: [built.quote.amountIn], received: [built.quote.expectedOut] },
      });
    }));

  it("refuses a swap whose router also moves the wallet's tokens to a stranger", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork);
      await holdUsdt(fork);
      const quote = await quoteOf(fork, buyIn, [wbnb, usdt]);
      const pull = { token: usdt, to: thief, base: quote / 1_000n };
      await fork.call("anvil_setCode", [relay, fakeRouterCode(router)]);
      await fork.call("anvil_setCode", [skimmer, fakeRouterCode(router, pull)]);
      // An allowance the wallet left the skimming router earlier: the hidden pull spends it.
      await approveOnChain(fork, skimmer);
      const clean = await buyThrough(bench, relay);
      const skimming = await buyThrough(bench, skimmer);

      await expect(bench.check.simulate(intent, clean, { signal })).resolves.toMatchObject({
        ok: true,
      });
      await expect(bench.check.simulate(intent, skimming, { signal })).resolves.toStrictEqual({
        ok: false,
        error: "effects_differ",
      });

      // The node shows the hidden transfer, though the wallet still receives above its minimum:
      // the check refuses the outflow, not the balance.
      const steps = await bench.simulator.simulate(skimming.steps, { signal });
      const wallet = evmAccountRef(fork.chain, fork.account);
      const usdtAsset = erc20AssetRef(fork.chain, usdt);
      expect(steps.flatMap((step) => step.transfers)).toContainEqual({
        from: wallet,
        to: evmAccountRef(fork.chain, thief),
        amount: { asset: usdtAsset, base: pull.base },
      });
      expect(quote - pull.base).toBeGreaterThan(skimming.quote.minOut.base);
      expect(checkEffects(steps, boundsOf(bench, skimming))).toStrictEqual({
        ok: false,
        error: "other_outflow",
      });
    }));

  it("passes a paper buy from an empty wallet with its paper BNB, which the node refuses without", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork);
      const quote = await quoteOf(fork, buyIn, [wbnb, usdt]);
      const data = encodeFunctionData({
        abi: routerAbi,
        functionName: "swapExactETHForTokens",
        args: [(quote * 99n) / 100n, [wbnb, usdt], emptyWallet, await deadlineOf(fork)],
      });
      const built = builtOf(
        { asset: fork.chain.nativeAsset, base: buyIn },
        { asset: erc20AssetRef(fork.chain, usdt), base: quote },
        [draft(fork, { from: emptyWallet, to: router, data, value: buyIn })],
      );
      const balances = [{ asset: fork.chain.nativeAsset, base: 10n ** 18n }];

      await expect(bench.check.simulate(intent, built, { signal })).rejects.toMatchObject({
        code: "chain.simulation_failed",
      });
      await expect(
        bench.check.simulate(intent, built, { signal, balances }),
      ).resolves.toMatchObject({
        ok: true,
        value: { spent: [built.quote.amountIn], received: [built.quote.expectedOut] },
      });
    }));

  it("passes a paper sale of USDT the empty wallet holds only on paper, set in USDT's storage", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork);
      const quote = await quoteOf(fork, saleIn, [usdt, wbnb]);
      const approve = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [router, saleIn],
      });
      const sell = encodeFunctionData({
        abi: routerAbi,
        functionName: "swapExactTokensForETH",
        args: [saleIn, (quote * 99n) / 100n, [usdt, wbnb], emptyWallet, await deadlineOf(fork)],
      });
      const usdtAsset = erc20AssetRef(fork.chain, usdt);
      const built = builtOf(
        { asset: usdtAsset, base: saleIn },
        { asset: fork.chain.nativeAsset, base: quote },
        [
          draft(fork, { from: emptyWallet, to: usdt, data: approve }),
          draft(fork, { from: emptyWallet, to: router, data: sell }),
        ],
      );
      const balances = [{ asset: usdtAsset, base: saleIn }];

      await expect(bench.check.simulate(intent, built, { signal })).resolves.toMatchObject({
        ok: false,
      });
      await expect(
        bench.check.simulate(intent, built, { signal, balances }),
      ).resolves.toMatchObject({
        ok: true,
        value: { spent: [built.quote.amountIn], received: [built.quote.expectedOut] },
      });
    }));

  it("refuses a plan that also raises a stranger's allowance on the wallet's tokens", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork);
      const buy = await buyThrough(bench, router);
      const raise = encodeFunctionData({
        abi: allowanceAbi,
        functionName: "increaseAllowance",
        args: [thief, 10n ** 18n],
      });
      const built = { ...buy, steps: [...buy.steps, draft(fork, { to: usdt, data: raise })] };

      await expect(bench.check.simulate(intent, built, { signal })).resolves.toStrictEqual({
        ok: false,
        error: "effects_differ",
      });
      const steps = await bench.simulator.simulate(built.steps, { signal });
      expect(checkEffects(steps, boundsOf(bench, built))).toStrictEqual({
        ok: false,
        error: "other_approval",
      });
    }));
});
