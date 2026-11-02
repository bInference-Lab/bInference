import { type AssetRef, assetRefSchema } from "@binference/chain";
import type { ReceiptPool, StakingVenue } from "@binference/chain/staking";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testCoin } from "../intents/test-intents.js";
import { stakingChains, testStakingFake, testValidator } from "../staking/test-stakes.js";
import { createStakingHost } from "./staking-host.js";

const receipt = assetRefSchema.parse("fake:1/token:0x000000c1");
const other = assetRefSchema.parse("fake:1/token:0x000000c9");
const live = { signal: new AbortController().signal };
const good: ReceiptPool = {
  validator: testValidator,
  pool: { shares: { asset: receipt, base: 100n }, coin: { asset: testCoin, base: 105n } },
};

function hostAnswering(answer: () => Promise<readonly ReceiptPool[]>) {
  const venue: StakingVenue = { ...testStakingFake(), pools: answer };
  const host = createStakingHost({
    venues: [venue],
    chains: stakingChains(),
    clock: createManualClock(1_800_000_000_000),
  });
  return { host, venue };
}

async function poolsOf(answer: readonly ReceiptPool[], named: readonly AssetRef[] = [receipt]) {
  const { host, venue } = hostAnswering(async () => Promise.resolve(answer));
  return host.pools(venue, named, live);
}

describe("the staking host's pools", () => {
  it("answers a copy of each pool of a receipt named", async () => {
    expect(await poolsOf([good])).toStrictEqual({ ok: true, value: [good] });
  });

  it("asks nothing for no receipt", async () => {
    const { host, venue } = hostAnswering(async () => Promise.reject(new Error("asked")));
    expect(await host.pools(venue, [], live)).toStrictEqual({ ok: true, value: [] });
  });

  it("is venue_down for a pool of a receipt not named, named twice, empty or of another coin", async () => {
    const empty = { ...good, pool: { ...good.pool, shares: { asset: receipt, base: 0n } } };
    const otherCoin = { ...good, pool: { ...good.pool, coin: { asset: receipt, base: 1n } } };
    const unnamed = { ...good, pool: { ...good.pool, shares: { asset: other, base: 1n } } };
    const answers = await Promise.all([
      poolsOf([unnamed]),
      poolsOf([good, good]),
      poolsOf([empty]),
      poolsOf([otherCoin]),
    ]);
    expect(answers.map((answer) => answer.ok)).toStrictEqual([false, false, false, false]);
  });

  it("is venue_down for a venue that throws", async () => {
    const { host, venue } = hostAnswering(async () => Promise.reject(new Error("down")));
    expect(await host.pools(venue, [receipt], live)).toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("lists the staking venues it runs on a chain", () => {
    const { host, venue } = hostAnswering(async () => Promise.resolve([]));
    expect(host.venuesOn(venue.chain)).toStrictEqual([venue]);
  });
});
