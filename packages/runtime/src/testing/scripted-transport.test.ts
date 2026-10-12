import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { modelChainContract } from "../contracts/model-chain-contract.js";
import { modelTransportContract } from "../contracts/model-transport-contract.js";
import {
  createScriptedTransport,
  createTestChain,
  oneModelChain,
  textReply,
} from "./scripted-transport.js";

describe("createScriptedTransport", () => {
  it.each(
    modelTransportContract({
      create: async () => createScriptedTransport([textReply("Hello.")]),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});

describe("createTestChain", () => {
  it.each(
    modelChainContract({
      create: async () => {
        const clock = createManualClock(1_000);
        const transport = createScriptedTransport([]);
        const chain = createTestChain([{ name: "a/one", transport }], {
          clock,
          cooldownMs: 30_000,
        });
        return { chain, cooldownMs: 30_000, advance: clock.advance };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});

describe("oneModelChain", () => {
  it.each(
    modelChainContract({
      create: async () => {
        const clock = createManualClock(1_000);
        const chain = oneModelChain(createScriptedTransport([]), clock);
        return { chain, cooldownMs: 60_000, advance: clock.advance };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
