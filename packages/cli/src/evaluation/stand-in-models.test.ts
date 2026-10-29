import { createManualClock } from "@binference/core/testing";
import { modelChainContract } from "@binference/runtime/testing";
import { describe, expect, it } from "vitest";
import { standInChain, visionChain } from "./stand-in-models.js";

describe.each([
  ["standInChain", (clock: ReturnType<typeof createManualClock>) => standInChain([], clock)],
  ["visionChain", (clock: ReturnType<typeof createManualClock>) => visionChain([], clock)],
] as const)("the chain of %s", (_name, chainOf) => {
  it.each(
    modelChainContract({
      create: async () => {
        const clock = createManualClock(1_000);
        return { chain: chainOf(clock), cooldownMs: 60_000, advance: clock.advance };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
