import { accountRefSchema, chainRefSchema, type SignedTx } from "@binference/chain";
import { createFakeNetwork, relaySenderContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { createMemoryEngineStores } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { notingSender } from "./executor-rig.js";

const chain = chainRefSchema.parse("fake:1");
const account = accountRefSchema.parse("fake:1:0x0000000c");
const signed: SignedTx = {
  chain,
  raw: "fake-signed|0x0000000c|0x0000000b|0|swap|0|50000000",
};

describe("the fork rig's noting sender", () => {
  it.each(
    relaySenderContract({
      create: async (behaviors) => {
        const relays = behaviors.map((_, index) => `relay-${String(index)}`);
        const network = createFakeNetwork({ chain, clock: createManualClock(), relays });
        behaviors.forEach((behavior, index) => {
          network.script(`relay-${String(index)}`, behavior);
        });
        const notes = { stores: createMemoryEngineStores(), account, sends: [] };
        const sender = notingSender(network, notes);
        return await Promise.resolve({ sender, signed, received: () => network.received() });
      },
    }),
  )("follows the relay sender contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("notes what the store held for the wallet as each send began", async () => {
    const network = createFakeNetwork({ chain, clock: createManualClock() });
    const notes = { stores: createMemoryEngineStores(), account, sends: [] };
    await notingSender(network, notes).send(signed, { signal: new AbortController().signal });

    expect(notes.sends).toStrictEqual([{ raw: signed.raw, stored: [] }]);
  });
});
