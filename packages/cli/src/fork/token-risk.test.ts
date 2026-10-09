import type { AssetRef, TokenRiskReport, TokenRiskSource } from "@binference/chain";
import { createEvmTxSimulator, erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { createFakeRiskSource } from "@binference/chain/testing";
import { bpsSchema, type Http } from "@binference/core";
import { createScriptedHttp, createSeededRandom } from "@binference/core/testing";
import { createVenueHost, type VenueHost } from "@binference/engine";
import { createRiskCheck, type RiskCheck, type RiskSubject } from "@binference/engine/risk";
import { createMemoryRiskCacheStore } from "@binference/engine/testing";
import { createGoplusSource } from "@binference/goplus";
import { createHoneypotSource } from "@binference/honeypot-is";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createFeeTokenVenue } from "./fee-token-venue.js";

// The fixtures, each a live BSC token checked on chain and with GoPlus and honeypot.is on
// 2026-10-09. SPA has traded on its PancakeSwap v2 pair with USDT since 2025-06-28 and holds about
// $70,000 there, yet most of its 68,000 holders' sales fail: a sale reverts in TransferHelper. WebKey
// DAO 2.0 (wkeyDAO2) trades on its v2 pair with USDT, about $39 million deep, and takes 40% of
// every sale (buys and transfers are free); a scan of about 800 active v2 pairs that day found no
// token at 30% that sells, so the test holds it to a maximum of 30% as well. Venus (XVS) is a
// clean token on its v2 pair with WBNB that the registry does not list.
const honeypot = getAddress("0xE77E41c26B6460Afccb9971CA11Fa968647c43B7");
const taxed = getAddress("0xe0A281deFf5c9d8d67aF09D39340E134Ac81b82E");
const clean = getAddress("0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63");
const usdt = bscToken("USDT");
const cake = bscToken("Cake");

const buyIn = 2n * 10n ** 16n;
const deep: TokenRiskReport = { flags: [], liquidityUsdMicros: 10n ** 15n };
const tenPercent = bpsSchema.parse(1_000);

interface Bench {
  readonly fork: Fork;
  readonly host: VenueHost;
  readonly check: RiskCheck;
}

const assetOf = (fork: Fork, address: `0x${string}`): AssetRef =>
  erc20AssetRef(fork.chain, address);

// Sources that find every token clean, so whatever blocks comes from the round trip alone.
function cleanSources(fork: Fork, tokens: readonly `0x${string}`[]): readonly TokenRiskSource[] {
  const reports = new Map(tokens.map((token) => [assetOf(fork, token), deep]));
  return [createFakeRiskSource({ id: "goplus", reports })];
}

function benchOf(fork: Fork, sources: readonly TokenRiskSource[]): Bench {
  const chains = selfHostedChains();
  const clock = createSystemClock();
  // SPA and wkeyDAO2 trade against USDT on PancakeSwap v2, so a trade routes BNB through it.
  const via = new Map([
    [assetOf(fork, honeypot), usdt],
    [assetOf(fork, taxed), usdt],
  ]);
  const venue = createFeeTokenVenue({ fork, nativeAsset: fork.chain.nativeAsset, via });
  const host = createVenueHost({ venues: [venue], chains, clock, callTimeoutMs: 15_000 });
  const check = createRiskCheck({
    sources: sources.map((source, index) => ({ source, isRequired: index === 0 })),
    cache: createMemoryRiskCacheStore(["goplus", "honeypot"]),
    cacheTtlMs: 600_000,
    sourceTimeoutMs: 15_000,
    host,
    simulator: createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain }),
    chains,
    clock,
    random: createSeededRandom(53),
  });
  return { fork, host, check };
}

// The trade a wallet would make: 0.02 BNB for the token, quoted on the fork.
async function subjectOf(
  bench: Bench,
  token: `0x${string}`,
  maxTaxBps = tenPercent,
): Promise<RiskSubject> {
  const { fork, host } = bench;
  const trade = {
    venue: "pancakeswap",
    wallet: evmAccountRef(fork.chain, fork.account),
    amountIn: { asset: fork.chain.nativeAsset, base: buyIn },
    assetOut: assetOf(fork, token),
    maxSlippageBps: bpsSchema.parse(100),
  };
  const quoted = await host.quote(trade, { signal: AbortSignal.timeout(30_000) });
  if (!quoted.ok) {
    throw new Error(`The fork venue did not quote ${token}: ${quoted.error}.`);
  }
  return { quoted: quoted.value, limits: { maxTaxBps, liquidityFloorUsdMicros: 10_000_000_000n } };
}

// GoPlus's own API, which no source of this test reaches: every request fails as unreachable.
const unreachable: Http = createScriptedHttp([]);

describe("token risk on a BSC fork", () => {
  it("blocks a honeypot whose test sale reverts, though its sources find it clean", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork, cleanSources(fork, [honeypot]));
      const assessment = await bench.check.assess(await subjectOf(bench, honeypot), { signal });
      expect(assessment.refusal).toBe("cannot_sell");
      expect(assessment.view.flags).toContainEqual({ code: "cannot_sell", source: "simulation" });
    }));

  it("measures a 40% sell tax its sources miss, and blocks it above a 10% or a 30% maximum", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork, cleanSources(fork, [taxed]));
      const assessment = await bench.check.assess(await subjectOf(bench, taxed), { signal });
      expect(assessment.refusal).toBe("high_tax");
      expect(assessment.view).toMatchObject({ verdict: "block", buyTaxBps: 0 });
      expect(assessment.view.sellTaxBps).toBeGreaterThanOrEqual(3_990);
      expect(assessment.view.sellTaxBps).toBeLessThanOrEqual(4_010);
      const atThirty = await subjectOf(bench, taxed, bpsSchema.parse(3_000));
      await expect(bench.check.assess(atThirty, { signal })).resolves.toMatchObject({
        refusal: "high_tax",
      });
      const atFortyFive = await subjectOf(bench, taxed, bpsSchema.parse(4_500));
      await expect(bench.check.assess(atFortyFive, { signal })).resolves.toMatchObject({
        view: { verdict: "warn" },
      });
    }));

  it("passes a clean token the registry does not list, with no tax measured", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const bench = benchOf(fork, cleanSources(fork, [clean]));
      const assessment = await bench.check.assess(await subjectOf(bench, clean), { signal });
      expect(assessment.refusal).toBeUndefined();
      expect(assessment.view).toMatchObject({ verdict: "pass", buyTaxBps: 0, sellTaxBps: 0 });
    }));

  it("blocks an unknown token while GoPlus is down, and passes a registry token", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const sources = [
        createGoplusSource({ http: unreachable }),
        createHoneypotSource({ http: unreachable }),
      ];
      const bench = benchOf(fork, sources);
      await expect(
        bench.check.assess(await subjectOf(bench, clean), { signal }),
      ).resolves.toMatchObject({
        refusal: "sources_down",
        view: {
          flags: [
            { code: "unavailable", source: "goplus" },
            { code: "unavailable", source: "honeypot" },
          ],
        },
      });
      const listed = await bench.check.assess(await subjectOf(bench, cake), { signal });
      expect([listed.refusal, listed.view.verdict, listed.view.flags]).toStrictEqual([
        undefined,
        "pass",
        [],
      ]);
    }));
});
