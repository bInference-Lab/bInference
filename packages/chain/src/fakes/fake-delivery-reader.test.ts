import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { deliveryReaderContract } from "../contracts/delivery-reader-contract.js";
import type { TxHash } from "../transaction.js";
import { createFakeDeliveryReader } from "./fake-delivery-reader.js";

const chain = chainRefSchema.parse("fake:2");
const recipient = accountRefSchema.parse("fake:2:0x000000b1");
const token = assetRefSchema.parse("fake:2/token:0x000000f3");
const hash = (byte: string) => `0x${byte.repeat(32)}` as TxHash;

describe("fake delivery reader", () => {
  it.each(
    deliveryReaderContract({
      create: async () => {
        const reader = createFakeDeliveryReader(chain);
        const received = { asset: token, base: 99n };
        reader.hold(recipient, { asset: token, base: 1_000n });
        const emitter = accountRefSchema.parse("fake:2:0x000000e2");
        const events = [{ emitter, topics: [], data: "filled" }];
        reader.land(hash("a1"), { recipient, received: [received], events });
        reader.land(hash("a2"), { recipient, received: [received], status: "failed" });
        return await Promise.resolve({
          reader,
          recipient,
          holding: { asset: token, base: 1_000n },
          delivered: hash("a1"),
          received,
          emitter,
          failed: hash("a2"),
          unknown: hash("a3"),
          stranger: accountRefSchema.parse("fake:1:0x000000b1"),
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads a landing that is not final yet as not final, and nothing for another recipient", async () => {
    const reader = createFakeDeliveryReader(chain);
    reader.land(hash("b1"), { recipient, received: [{ asset: token, base: 5n }], final: false });
    const live = { signal: new AbortController().signal };
    await expect(
      reader.delivery({ hash: hash("b1"), recipient, asset: token }, live),
    ).resolves.toMatchObject({
      final: false,
      received: { base: 5n },
    });
    const other = accountRefSchema.parse("fake:2:0x000000b2");
    await expect(
      reader.delivery({ hash: hash("b1"), recipient: other, asset: token }, live),
    ).resolves.toMatchObject({
      received: { base: 0n },
    });
  });
});
