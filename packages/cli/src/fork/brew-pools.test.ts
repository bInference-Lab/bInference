import { accountRefSchema, type SimulatedStep } from "@binference/chain";
import { createEvmTxSimulator, erc20AssetRef } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { BinferenceError, bpsSchema, type Http } from "@binference/core";
import { createVenueHost, type TradePlan, type VenueTrade } from "@binference/engine";
import { createKyberswapVenue } from "@binference/kyberswap";
import { recordedWallet } from "@binference/kyberswap/testing";
import { successOf } from "@binference/plugin-sdk/testing";
import { type Address, getAddress, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { brewOn } from "./launch-wallet-parts.js";

// Brew's tokens trade in their PancakeSwap V3 pools through the aggregators (decision 0278): a buy
// of BREW, which BrewFactory launched and records, routes through KyberSwap into its launch pool,
// and a token BrewFactory never recorded, here one launched by a Brew factory binference does not
// list, is no Brew token at all. KyberSwap's public API quotes; nothing else is reached.
const kyberswapOrigin = "https://aggregator-api.kyberswap.com";
const network = createSystemHttp({ version: "test" });
const factory = bscContract("brew", "factory");
// BREW, a BrewToken BrewFactory launched against WBNB, read on 2026-10-20.
const brewToken = getAddress("0xfa6D9B504848606Eb9aeC04CCc161D169B3f2159");
// BrewLife, a token whose address ends in 6666 as Brew's do, which BrewFactory never recorded.
const unrecorded = getAddress("0x7e01cec7bef69265ee3b65f2308265cb24d46666");
const factoryAbi = parseAbi([
  "function launches(address token) view returns (address token, address quoteToken, address pool, address creator, uint24 fee, uint64 launchedAtBlock)",
]);

const kyberswapHttp: Http = {
  async request(request) {
    if (new URL(request.url).origin !== kyberswapOrigin) {
      throw new BinferenceError({
        code: "fork.call_refused",
        message: "The fork test reaches no host but KyberSwap's API.",
      });
    }
    return network.request(request);
  },
};

// The venue host over KyberSwap and Brew on the fork, as the self-hosted engine runs them.
function hostOf(fork: Fork) {
  const kyberswap = createKyberswapVenue({
    http: kyberswapHttp,
    clientId: () => "binference",
    chains: [{ chain: fork.chain.ref, nativeAsset: fork.chain.nativeAsset, allowedHooks: [] }],
  });
  const chains = selfHostedChains();
  const clock = createSystemClock();
  return createVenueHost({
    venues: [kyberswap, brewOn(fork)],
    chains,
    clock,
    callTimeoutMs: 20_000,
  });
}

const buyOf = (fork: Fork, venue: string, token: Address): VenueTrade => ({
  venue,
  wallet: recordedWallet,
  amountIn: { asset: fork.chain.nativeAsset, base: 10n ** 16n },
  assetOut: erc20AssetRef(fork.chain, token),
  maxSlippageBps: bpsSchema.parse(100),
});

async function recordOf(fork: Fork, token: Address) {
  const [recorded, quoteToken, pool] = await fork.client.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "launches",
    args: [token],
  });
  return { recorded, quoteToken, pool };
}

// The least the trade takes, which a buy always names.
function minOutOf(plan: TradePlan): bigint {
  if (plan.terms.minOutBase === undefined) {
    throw new BinferenceError({ code: "fork.no_min_out", message: "The plan names no minimum." });
  }
  return plan.terms.minOutBase;
}

// What of BREW the simulated buy moved out of the launch pool, and what the wallet got.
function brewMovedIn(
  fork: Fork,
  run: { readonly steps: readonly SimulatedStep[]; readonly pool: Address },
) {
  const pool = accountRefSchema.parse(`${fork.chain.ref}:${run.pool}`);
  const token = erc20AssetRef(fork.chain, brewToken);
  const transfers = run.steps
    .flatMap((step) => step.transfers)
    .filter((item) => item.amount.asset === token);
  const sum = (to: (item: (typeof transfers)[number]) => boolean) =>
    transfers.filter(to).reduce((total, item) => total + item.amount.base, 0n);
  return {
    fromPool: sum((item) => item.from === pool),
    bought: sum((item) => item.to === recordedWallet),
  };
}

describe("brew tokens in their pools on a BSC fork", () => {
  it("buys a token BrewFactory records through KyberSwap, out of its launch pool", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const record = await recordOf(fork, brewToken);
      expect(record).toMatchObject({ recorded: brewToken, quoteToken: bscToken("WBNB") });
      const host = hostOf(fork);
      await expect(host.quote(buyOf(fork, "brew", brewToken), { signal })).resolves.toStrictEqual({
        ok: false,
        error: "no_route",
      });
      const quoted = successOf(await host.quote(buyOf(fork, "kyberswap", brewToken), { signal }));
      const plan = successOf(await host.build(quoted, { signal }));
      const simulator = createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain });
      const steps = await simulator.simulate(
        plan.steps.map((step) => step.draft),
        { signal, balances: [buyOf(fork, "kyberswap", brewToken).amountIn] },
      );
      const { fromPool, bought } = brewMovedIn(fork, { steps, pool: record.pool });
      expect(steps.map((step) => step.status)).not.toContain("reverted");
      expect(fromPool).toBeGreaterThan(0n);
      expect(bought).toBeGreaterThanOrEqual(minOutOf(plan));
      await annotate(
        `block ${String(fork.block)}: 0.01 BNB bought ${String(bought)} BREW through KyberSwap, out of the launch pool ${record.pool}`,
      );
    }));

  it("finds no launch record for a token BrewFactory never launched, which no Brew read names", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const zero = "0x0000000000000000000000000000000000000000";
      await expect(recordOf(fork, unrecorded)).resolves.toStrictEqual({
        recorded: zero,
        quoteToken: zero,
        pool: zero,
      });
      const host = hostOf(fork);
      await expect(host.quote(buyOf(fork, "brew", unrecorded), { signal })).resolves.toStrictEqual({
        ok: false,
        error: "no_route",
      });
      await expect(
        host.insiders("brew", erc20AssetRef(fork.chain, unrecorded), { signal }),
      ).resolves.toStrictEqual({ ok: true, value: [] });
    }));
});
