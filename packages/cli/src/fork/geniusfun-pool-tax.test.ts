import { type AssetTransfer, type TokenRiskReport, accountRefSchema } from "@binference/chain";
import { createEvmTxSimulator, erc20AssetRef } from "@binference/chain-evm";
import { bscContract, type Fork, withFork } from "@binference/chain-evm/fork";
import { createFakeRiskSource } from "@binference/chain/testing";
import { BinferenceError, bpsSchema, type Http } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { createVenueHost, type VenueTrade } from "@binference/engine";
import { createRiskCheck } from "@binference/engine/risk";
import { createMemoryRiskCacheStore } from "@binference/engine/testing";
import { createKyberswapVenue } from "@binference/kyberswap";
import { recordedWallet } from "@binference/kyberswap/testing";
import { successOf } from "@binference/plugin-sdk/testing";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp } from "../runtime/system-http.js";

// The risk step's round trip on a token whose Genius.fun launch graduated into its m4.1 pool, which
// KyberSwap routes through once the pool's hook is allowed (decisions 0214 and 0215). The hook keeps
// 2% of the token side of a buy by sending it out of the pool's vault, so the round trip measures
// it apart from the token's own tax. KyberSwap's public API quotes; nothing else is reached.
const kyberswapOrigin = "https://aggregator-api.kyberswap.com";
const network = createSystemHttp({ version: "test" });
// A token whose launch graduated into its m4.1 pool, read on 2026-10-14; it takes no tax of its own.
const graduated = getAddress("0xc458f88CB2618dC66C959e3e3f56383A1bfBEE74");
const hook = bscContract("geniusfun", "hook-m4-1");

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

function benchOf(fork: Fork) {
  const chains = selfHostedChains();
  const clock = createSystemClock();
  const allowedHooks = [{ address: hook, feeBps: bpsSchema.parse(200), maker: "Genius.fun" }];
  const venue = createKyberswapVenue({
    http: kyberswapHttp,
    clientId: () => "binference",
    chains: [{ chain: fork.chain.ref, nativeAsset: fork.chain.nativeAsset, allowedHooks }],
  });
  const host = createVenueHost({ venues: [venue], chains, clock, callTimeoutMs: 20_000 });
  const simulator = createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain });
  const token = erc20AssetRef(fork.chain, graduated);
  const deep: TokenRiskReport = { flags: [], liquidityUsdMicros: 10n ** 15n };
  const source = createFakeRiskSource({ id: "goplus", reports: new Map([[token, deep]]) });
  const check = createRiskCheck({
    sources: [{ source, isRequired: true }],
    cache: createMemoryRiskCacheStore(["goplus"]),
    cacheTtlMs: 600_000,
    sourceTimeoutMs: 15_000,
    host,
    simulator,
    chains,
    clock,
    random: createSeededRandom(215),
  });
  return { host, simulator, check, token };
}

// What of the token reached the hook, of all the token the buy moved out to the hook and the buyer.
function hookShareOf(transfers: readonly AssetTransfer[], fork: Fork, token: string) {
  const hookAccount = accountRefSchema.parse(`${fork.chain.ref}:${hook}`);
  const tokens = transfers.filter((item) => item.amount.asset === token);
  const toHook = tokens.filter((item) => item.to === hookAccount).map((item) => item.amount.base);
  const toBuyer = tokens
    .filter((item) => item.to === recordedWallet)
    .map((item) => item.amount.base);
  const taken = toHook.reduce((sum, base) => sum + base, 0n);
  const bought = toBuyer.reduce((sum, base) => sum + base, 0n);
  const moved = taken + bought;
  // Rounded up, as the round trip reads a share.
  return { taken, bought, bps: (taken * 10_000n + moved - 1n) / moved };
}

describe("a graduated geniusfun token's hooked pool on a BSC fork", () => {
  it("measures the pool hook's 2% apart from the token's tax, and counts it once against the maximum", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const { host, simulator, check, token } = benchOf(fork);
      const trade: VenueTrade = {
        venue: "kyberswap",
        wallet: recordedWallet,
        amountIn: { asset: fork.chain.nativeAsset, base: 10n ** 16n },
        assetOut: token,
        maxSlippageBps: bpsSchema.parse(100),
      };
      const quoted = successOf(await host.quote(trade, { signal }));
      expect(quoted.quote.hookFees).toStrictEqual([
        { maker: "Genius.fun", feeBps: 200, hooks: [`${fork.chain.ref}:${hook}`] },
      ]);
      const plan = successOf(await host.build(quoted, { signal }));
      const balances = [trade.amountIn];
      const steps = await simulator.simulate(
        plan.steps.map((step) => step.draft),
        { signal, balances },
      );
      const share = hookShareOf(
        steps.flatMap((step) => step.transfers),
        fork,
        token,
      );
      expect(share.bps).toBe(200n);
      const floor = 10n ** 10n;
      const atTen = { maxTaxBps: bpsSchema.parse(1_000), liquidityFloorUsdMicros: floor };
      const atOne = { maxTaxBps: bpsSchema.parse(100), liquidityFloorUsdMicros: floor };
      const passed = await check.assess({ quoted, limits: atTen }, { signal });
      const refused = await check.assess({ quoted, limits: atOne }, { signal });
      expect(passed).toMatchObject({ view: { verdict: "pass", buyTaxBps: 0, sellTaxBps: 0 } });
      expect(passed).not.toHaveProperty("refusal");
      expect(refused).toMatchObject({ refusal: "high_pool_fee", view: { buyTaxBps: 0 } });
      await annotate(
        `block ${String(fork.block)}, token ${graduated}: 0.01 BNB bought ${String(share.bought)}, the hook ${hook} took ${String(share.taken)} (${String(share.bps)} bp) out of the vault; round trip buy tax ${String(passed.view.buyTaxBps)} bp, sell tax ${String(passed.view.sellTaxBps)} bp; at a 10% maximum ${passed.view.verdict}, at 1% ${String(refused.refusal)}`,
      );
    }));
});
