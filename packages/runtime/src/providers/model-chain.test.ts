import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { modelChainContract } from "../contracts/model-chain-contract.js";
import { createScriptedTransport } from "../testing/scripted-transport.js";
import { createModelChain } from "./model-chain.js";

describe("createModelChain", () => {
  it.each(
    modelChainContract({
      create: async () => {
        const clock = createManualClock(1_000);
        const transport = createScriptedTransport([]);
        const rests = { clock, cooldownMs: 45_000, until: new Map<string, number>() };
        const chain = createModelChain([{ name: "p/one", transport }], rests);
        return { chain, cooldownMs: 45_000, advance: clock.advance };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("never shortens a rest that a longer wait began", () => {
    const clock = createManualClock(1_000);
    const transport = createScriptedTransport([]);
    const until = new Map<string, number>();
    const chain = createModelChain([{ name: "p/one", transport }], {
      clock,
      cooldownMs: 10,
      until,
    });
    chain.rest("p/one", 90_000);
    chain.rest("p/two", 0);
    expect(until.get("p")).toBe(91_000);
  });
});
