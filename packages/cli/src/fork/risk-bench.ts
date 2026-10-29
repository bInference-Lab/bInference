import type { AssetRef, TokenRiskReport, TokenRiskSource } from "@binference/chain";
import { createEvmTxSimulator, erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { bscToken, type Fork } from "@binference/chain-evm/fork";
import { createFakeRiskSource } from "@binference/chain/testing";
import { type Bps, bpsSchema } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { createVenueHost, type VenueHost } from "@binference/engine";
import { createRiskCheck, type RiskCheck, type RiskSubject } from "@binference/engine/risk";
import { createMemoryRiskCacheStore } from "@binference/engine/testing";
import { getAddress } from "viem";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createFeeTokenVenue } from "./fee-token-venue.js";

// The engine's token risk check on the fork suite's BSC fork, with a venue that trades BNB for a
// token on PancakeSwap v2, and the live tokens it is checked on.

// The live fixtures, each a BSC token checked on chain and with GoPlus and honeypot.is on
// 2026-10-09. SPA has traded on its PancakeSwap v2 pair with USDT since 2025-06-28 and holds about
// $70,000 there, yet most of its 68,000 holders' sales fail: a sale reverts in TransferHelper, and
// since late October a buyer's transfer to another wallet reverts too, so which leg the round trip
// sees refused follows the token, not the test. The refusing tokens of `refusing-token.ts` hold
// each leg's refusal fixed. WebKey
// DAO 2.0 (wkeyDAO2) trades on its v2 pair with USDT, about $39 million deep, and takes 40% of
// every sale (buys and transfers are free); a scan of about 800 active v2 pairs that day found no
// token at 30% that sells, so the test holds it to a maximum of 30% as well. Venus (XVS) is a
// clean token on its v2 pair with WBNB that the registry does not list.
/** SPA, a live honeypot: its sales revert, and since late October its buyers' transfers too. */
export const honeypot: `0x${string}` = getAddress("0xE77E41c26B6460Afccb9971CA11Fa968647c43B7");
/** wkeyDAO2, which takes 40% of every sale. */
export const taxed: `0x${string}` = getAddress("0xe0A281deFf5c9d8d67aF09D39340E134Ac81b82E");
/** Venus (XVS), clean, which the registry does not list. */
export const clean: `0x${string}` = getAddress("0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63");
const usdt = bscToken("USDT");

const buyIn = 2n * 10n ** 16n;
const deep: TokenRiskReport = { flags: [], liquidityUsdMicros: 10n ** 15n };
// The maximum tax a check holds a token to unless a test names another: 10%.
const tenPercent: Bps = bpsSchema.parse(1_000);

/** The fork, its venue host and the risk check over them. */
export interface RiskBench {
  readonly fork: Fork;
  readonly host: VenueHost;
  readonly check: RiskCheck;
}

const assetOf = (fork: Fork, address: `0x${string}`): AssetRef =>
  erc20AssetRef(fork.chain, address);

/** Sources that find every token clean, so whatever blocks comes from the round trip alone. */
export function cleanSources(
  fork: Fork,
  tokens: readonly `0x${string}`[],
): readonly TokenRiskSource[] {
  const reports = new Map(tokens.map((token) => [assetOf(fork, token), deep]));
  return [createFakeRiskSource({ id: "goplus", reports })];
}

/** The risk check on the fork, with the sources given, the first of them required. */
export function benchOf(fork: Fork, sources: readonly TokenRiskSource[]): RiskBench {
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
    cacheTtlMs: () => 600_000,
    sourceTimeoutMs: 15_000,
    host,
    simulator: createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain }),
    chains,
    clock,
    random: createSeededRandom(53),
  });
  return { fork, host, check };
}

/** The trade a wallet would make: 0.02 BNB for the token, quoted on the fork. */
export async function subjectOf(
  bench: RiskBench,
  token: `0x${string}`,
  maxTaxBps: Bps = tenPercent,
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
