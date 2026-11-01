import { accountRefSchema, assetRefSchema, chainRefSchema, type TxHash } from "@binference/chain";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { BridgeCursor, BridgeQuery, BridgeRecord } from "./bridge-record.js";
import { createBridgeFollower, type BridgeFollowParts } from "./follow-bridges.js";
import type { BridgeStore } from "./ports.js";

const live = { signal: new AbortController().signal };
const asset = assetRefSchema.parse("fake:1/token:0x000000f1");

// One open bridge a pass lists, its deposit `n` milliseconds after the first.
function rowOf(n: number): BridgeRecord {
  return {
    intentId: fixtureId("int", n + 1),
    venue: "fake-cross",
    depositTx: `0x${"d1".repeat(32)}` as TxHash,
    toChain: chainRefSchema.parse("fake:2"),
    recipient: accountRefSchema.parse("fake:2:0x000000b1"),
    sent: { asset, base: 1n },
    minOut: { asset, base: 1n },
    sentAtMs: n,
    state: "in_transit",
    version: 0,
  };
}

// The bridge store's list over 150 open bridges, noting where each pass asked to start.
function listingStore(asked: {
  readonly push: (after: BridgeCursor | undefined) => void;
}): BridgeStore {
  const rows = Array.from({ length: 150 }, (_, n) => rowOf(n));
  return {
    list: async (query: BridgeQuery) => {
      asked.push(query.after);
      const start = query.after === undefined ? 0 : query.after.sentAtMs + 1;
      return Promise.resolve(rows.slice(start, start + query.limit));
    },
  } as unknown as BridgeStore;
}

describe("the follower's passes", () => {
  it("read the next 100 open bridges each pass, then start again from the oldest", async () => {
    const asked: (BridgeCursor | undefined)[] = [];
    const parts = {
      bridges: listingStore(asked),
      stored: { snapshot: async () => Promise.resolve(undefined) } as unknown as StoredIntents,
      hosted: [],
      clock: createManualClock(),
    } as unknown as BridgeFollowParts;
    const follower = createBridgeFollower(parts);

    await follower.follow(live);
    await follower.follow(live);
    await follower.follow(live);

    expect(asked).toStrictEqual([
      undefined,
      { sentAtMs: 99, intentId: fixtureId("int", 100) },
      undefined,
    ]);
  });
});
