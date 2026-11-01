import { type Bridge, chainRefSchema, isTxHash, type TxHash } from "@binference/chain";
import { createFakeBridge } from "@binference/chain/testing";
import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { bridgeLateAfterMs } from "./bridge-settlement.js";
import { startBridgeFollowBench } from "./test-bridge-follow.js";
import { testArrives, testFarEntry } from "./test-bridges.js";

const fill = (() => {
  const hash = `0x${"f1".repeat(32)}`;
  if (!isTxHash(hash)) {
    throw new Error("Expected a hash.");
  }
  return { chain: chainRefSchema.parse("fake:2"), hash: hash satisfies TxHash };
})();

// The fake bridge whose status always fails with `code`, counting each time it is asked.
function failingVenue(code: `${string}.${string}`): {
  readonly bridge: Bridge;
  readonly asked: () => number;
} {
  let asked = 0;
  const fake = createFakeBridge({ routes: [] });
  const bridge: Bridge = {
    ...fake,
    status: async () => {
      asked += 1;
      return await Promise.reject(new BinferenceError({ code, message: "No status." }));
    },
  };
  return { bridge, asked: () => asked };
}

async function benchOver(bridge: Bridge) {
  return await startBridgeFollowBench({
    readers: [],
    recipient: testFarEntry.account,
    minOut: { asset: testArrives, base: 99_000_000n },
    fill,
    bridge,
  });
}

const keysOf = (bench: Awaited<ReturnType<typeof benchOver>>) =>
  bench.notices().map((notice) => notice.key);

describe("following a bridge whose venue does not say where it stands", () => {
  it("still marks it late after 2 hours, once, with the venue's page for the deposit", async () => {
    const venue = failingVenue("fake.unavailable");
    const bench = await benchOver(venue.bridge);
    await bench.follow();
    await bench.advance(bridgeLateAfterMs);
    await bench.follow();
    await bench.follow();

    expect(await bench.states()).toStrictEqual(["finalized", "late"]);
    const late = bench.notices().filter((notice) => notice.key === "notice.bridgeLate");
    expect(late).toMatchObject([
      { values: { venue: "fake-cross", statusUrl: `https://bridge.test/0x${"d1".repeat(32)}` } },
    ]);
  });

  it("logs the failure by its code at most once an hour per bridge", async () => {
    const bench = await benchOver(failingVenue("fake.unavailable").bridge);
    await bench.follow();
    await bench.follow();
    await bench.advance(60 * 60 * 1_000);
    await bench.follow();

    expect(bench.logged()).toStrictEqual([
      ["bridge.status_unread", "fake.unavailable"],
      ["bridge.status_unread", "fake.unavailable"],
    ]);
  });

  it("rests a venue that throttles, doubling the rest, and asks again once it ends", async () => {
    const venue = failingVenue("fake.rate_limited");
    const bench = await benchOver(venue.bridge);
    await bench.follow();
    await bench.follow();
    expect(venue.asked()).toBe(1);

    await bench.advance(30_000);
    await bench.follow();
    await bench.advance(30_000);
    await bench.follow();
    expect(venue.asked()).toBe(2);

    await bench.advance(30_000);
    await bench.follow();
    expect(venue.asked()).toBe(3);
  });

  it("tells the owner once that the venue needs a key, and still tells the late bridge", async () => {
    const bench = await benchOver(failingVenue("fake.unauthorized").bridge);
    await bench.follow();
    await bench.follow();
    await bench.advance(bridgeLateAfterMs);
    await bench.follow();

    expect(keysOf(bench)).toStrictEqual(["notice.bridgeKeyNeeded", "notice.bridgeLate"]);
    expect(bench.notices()[0]).toMatchObject({ values: { venue: "fake-cross" } });
  });
});
