import { accountRefSchema, assetRefSchema, chainRefSchema, type TxHash } from "@binference/chain";
import { createFakeBridge } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { defineBridge } from "./define-bridge.js";
import { bridgeContract } from "./testing.js";

const usd = assetRefSchema.parse("fake:1/token:0x000000f1");
const arrives = assetRefSchema.parse("fake:2/token:0x000000f3");
const destination = chainRefSchema.parse("fake:2");
const sent = { chain: chainRefSchema.parse("fake:1"), hash: "0xd1" as TxHash };
const fill = { chain: destination, hash: "0xf1" as TxHash };
const request = {
  wallet: accountRefSchema.parse("fake:1:0x000000a1"),
  amountIn: { asset: usd, base: 1_000n },
  recipient: accountRefSchema.parse("fake:2:0x000000b1"),
  deliveredAsset: arrives,
  cappedAssets: [usd],
  contracts: { spoke: accountRefSchema.parse("fake:1:0x000000e1") },
};

describe("defineBridge", () => {
  it.each(
    bridgeContract({
      create: async () => {
        const fake = createFakeBridge({ routes: [{ leaves: usd, arrives }] });
        const refund = { ...sent, hash: "0xa2" as TxHash };
        fake.settle(sent.hash, { kind: "filled", fill });
        fake.settle("0xd2" as TxHash, { kind: "refunded", refund });
        fake.settle("0xd3" as TxHash, { kind: "expired" });
        return await Promise.resolve({
          bridge: defineBridge(fake),
          request,
          unserved: { ...request, deliveredAsset: usd },
          otherRecipient: accountRefSchema.parse("fake:2:0x000000b2"),
          deposits: "bound" as const,
          filled: { deposit: sent, fill },
          refunded: { deposit: { ...sent, hash: "0xd2" as TxHash }, refund },
          expired: { ...sent, hash: "0xd3" as TxHash },
          unseen: { ...sent, hash: "0xe9" as TxHash },
        });
      },
    }),
  )("keeps the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("freezes what it declares", () => {
    const bridge = defineBridge(createFakeBridge({ routes: [] }));
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.isFrozen(bridge.destinations[0])).toBe(true);
    expect(bridge.destinations).toStrictEqual([{ chain: destination, id: "2" }]);
  });

  it.each([
    ["no destination", []],
    [
      "a chain twice",
      [
        { chain: destination, id: "2" },
        { chain: destination, id: "3" },
      ],
    ],
    ["an id that is no number", [{ chain: destination, id: "two" }]],
  ])("refuses %s", (_, destinations) => {
    const fake = createFakeBridge({ routes: [] });
    expect(() => defineBridge({ ...fake, destinations })).toThrow(
      expect.objectContaining({ code: "plugin.bad_venue" }),
    );
  });

  it("refuses a declaration with no chain", () => {
    const fake = createFakeBridge({ routes: [] });
    expect(() => defineBridge({ ...fake, contracts: [] })).toThrow(
      expect.objectContaining({ code: "plugin.bad_venue" }),
    );
  });
});
