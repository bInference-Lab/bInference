import {
  accountRefSchema,
  chainRefSchema,
  type DeliveryReader,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { createFakeBridge, createFakeDeliveryReader } from "@binference/chain/testing";
import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import { startBridgeFollowBench } from "./test-bridge-follow.js";
import { testArrives, testFarEntry } from "./test-bridges.js";

function hashOf(byte: string): TxHash {
  const hash = `0x${byte.repeat(32)}`;
  if (!isTxHash(hash)) {
    throw new Error("Expected a hash.");
  }
  return hash;
}

const destination = chainRefSchema.parse("fake:2");
const fill = { chain: destination, hash: hashOf("f1") };
const minOut = { asset: testArrives, base: 99_000_000n };

// A reader of the destination whose every read of a transaction throws the error made.
function throwingReader(made: () => Error): DeliveryReader {
  const reader = createFakeDeliveryReader(destination);
  return {
    ...reader,
    delivery: async () => {
      await Promise.resolve();
      throw made();
    },
  };
}

describe("following a bridge whose reads fail", () => {
  it("leaves a bridge in transit while custody gives no account of its wallet where it left", async () => {
    const deposit = {
      hash: hashOf("d2"),
      sent: { asset: testToken, base: 100_000_000n },
      wallet: accountRefSchema.parse("fake:2:0x000000a1"),
    };
    const bridge = createFakeBridge({ routes: [] });
    bridge.settle(deposit.hash, { kind: "filled", fill });
    const there = createFakeDeliveryReader(destination);
    there.land(fill.hash, { recipient: testFarEntry.account, received: [minOut] });
    const bench = await startBridgeFollowBench({
      readers: [there],
      recipient: testFarEntry.account,
      minOut,
      fill,
      deposit,
      bridge,
    });

    await bench.follow();

    expect(await bench.states()).toStrictEqual(["finalized", "in_transit"]);
    expect(bench.notices()).toStrictEqual([]);
  });

  it.each([
    { made: () => new Error("The node closed the socket."), code: "internal.error" },
    {
      made: () => new BinferenceError({ code: "fake.unavailable", message: "Down." }),
      code: "fake.unavailable",
    },
  ] as const)(
    "logs a read that throws by its code $code and reads it again next pass",
    async (row) => {
      const bench = await startBridgeFollowBench({
        readers: [throwingReader(row.made)],
        recipient: testFarEntry.account,
        minOut,
        fill,
      });

      await bench.follow();
      await bench.follow();

      expect(await bench.states()).toStrictEqual(["finalized", "in_transit"]);
      expect(bench.logged()).toStrictEqual([
        ["bridge.follow_failed", row.code],
        ["bridge.follow_failed", row.code],
      ]);
    },
  );

  it("leaves a refunded bridge in transit until its refund lands on the source chain", async () => {
    const depositTx = hashOf("d1");
    const bridge = createFakeBridge({ routes: [] });
    bridge.settle(depositTx, {
      kind: "refunded",
      refund: { chain: chainRefSchema.parse("fake:1"), hash: hashOf("e1") },
    });
    const bench = await startBridgeFollowBench({
      readers: [],
      recipient: testFarEntry.account,
      minOut,
      fill,
      depositHash: depositTx,
      bridge,
    });

    await bench.follow();

    expect(await bench.states()).toStrictEqual(["finalized", "in_transit"]);
    expect(bench.notices()).toStrictEqual([]);
  });
});
