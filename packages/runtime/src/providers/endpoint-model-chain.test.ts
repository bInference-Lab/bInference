import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { modelChainContract } from "../contracts/model-chain-contract.js";
import { endpointModelChain } from "./endpoint-model-chain.js";

describe("endpointModelChain", () => {
  it.each(
    modelChainContract({
      create: async () => {
        const clock = createManualClock(1_000);
        const endpoint = { baseUrl: "https://models.example.com/v1", model: "m" };
        const http = createScriptedHttp([]);
        const chain = endpointModelChain(endpoint, { http, clock, timeoutMs: 30_000 });
        return { chain, cooldownMs: 60_000, advance: clock.advance };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
