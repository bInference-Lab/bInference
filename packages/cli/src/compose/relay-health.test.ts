import { chainRefSchema, type SignedTx } from "@binference/chain";
import { createFakeNetwork, relaySenderContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createRelayHealth } from "./relay-health.js";

const chain = chainRefSchema.parse("fake:1");
const live = () => ({ signal: new AbortController().signal });
const signed = (nonce: number): SignedTx => ({
  chain,
  raw: `fake-signed|0x0000000c|0x0000000b|0|swap|${String(nonce)}|50000000`,
});

describe("the relay health", () => {
  it.each(
    relaySenderContract({
      create: async (behaviors) => {
        const relays = behaviors.map((_, index) => `relay-${String(index)}`);
        const network = createFakeNetwork({ chain, clock: createManualClock(), relays });
        behaviors.forEach((behavior, index) => {
          network.script(`relay-${String(index)}`, behavior);
        });
        const sender = createRelayHealth().watch(chain, network);
        return await Promise.resolve({
          sender,
          signed: signed(0),
          received: () => network.received(),
        });
      },
    }),
  )("watches a sender that follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("is ok until a relay fails, warns while one did, and fails once none took a send", async () => {
    const network = createFakeNetwork({ chain, clock: createManualClock() });
    const health = createRelayHealth();
    const sender = health.watch(chain, network);
    expect(health.state()).toBe("ok");
    await sender.send(signed(0), live());
    expect(health.state()).toBe("ok");
    network.script("relay-a", { kind: "hang" });
    await sender.send(signed(1), live());
    expect(health.state()).toBe("warn");
    network.script("relay-b", { kind: "unreachable" });
    await sender.send(signed(2), live());
    expect(health.state()).toBe("fail");
    network.script("relay-a", { kind: "accept" });
    network.script("relay-b", { kind: "accept" });
    await sender.send(signed(3), live());
    expect(health.state()).toBe("ok");
  });
});
