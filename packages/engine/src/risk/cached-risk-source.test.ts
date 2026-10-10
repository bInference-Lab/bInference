import { assetRefSchema, type TokenRiskReport } from "@binference/chain";
import { createFakeRiskSource, tokenRiskSourceContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createMemoryRiskCacheStore } from "../fakes/memory-risk-cache-store.js";
import { cachedRiskSource } from "./cached-risk-source.js";
import { unknownToken } from "./test-round-trip.js";

const other = assetRefSchema.parse("fake:1/token:0x0000000e");
const report: TokenRiskReport = { flags: ["mintable"], liquidityUsdMicros: 20_000_000_000n };
const live = { signal: new AbortController().signal };
const ttlMs = 600_000;

function cachedOf(options: { readonly isDown?: boolean } = {}) {
  const clock = createManualClock(1_800_000_000_000);
  const store = createMemoryRiskCacheStore(["first"]);
  const source = createFakeRiskSource({
    id: "first",
    reports: new Map([[unknownToken, report]]),
    ...options,
  });
  return { clock, store, source, cached: cachedRiskSource(source, { store, clock, ttlMs }) };
}

describe("cached risk source", () => {
  it.each(
    tokenRiskSourceContract({
      create: () => ({
        source: cachedOf().cached,
        known: unknownToken,
        unknown: other,
        down: cachedOf({ isDown: true }).cached,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("answers from the cache until the report is as old as the time to live", async () => {
    const { clock, source, cached } = cachedOf();
    await expect(cached.check(unknownToken, live)).resolves.toStrictEqual({
      ok: true,
      value: report,
    });
    await clock.advance(ttlMs - 1);
    await expect(cached.check(unknownToken, live)).resolves.toStrictEqual({
      ok: true,
      value: report,
    });
    expect(source.checks()).toBe(1);
    await clock.advance(1);
    await cached.check(unknownToken, live);
    expect(source.checks()).toBe(2);
  });

  it("stores the source's report under its id, with the time it came", async () => {
    const { clock, store, cached } = cachedOf();
    await cached.check(unknownToken, live);
    await expect(store.read({ asset: unknownToken, source: "first" }, live)).resolves.toStrictEqual(
      {
        asset: unknownToken,
        source: "first",
        report,
        fetchedAtMs: clock.now(),
      },
    );
  });

  it("asks the source again when the cached report is stamped later than now", async () => {
    const { clock, store, source, cached } = cachedOf();
    const ahead = { asset: unknownToken, source: "first", report, fetchedAtMs: clock.now() + 1 };
    await store.write(ahead, live);
    await cached.check(unknownToken, live);
    expect(source.checks()).toBe(1);
  });

  it("never stores a token the source does not cover, so the next check asks again", async () => {
    const { source, cached } = cachedOf();
    await cached.check(other, live);
    await cached.check(other, live);
    expect(source.checks()).toBe(2);
  });
});
