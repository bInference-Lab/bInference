import { chainRefSchema } from "@binference/chain";
import { chainRegistryContract } from "@binference/chain/testing";
import { bsc } from "@binference/chains";
import { describe, expect, it } from "vitest";
import { skeletonChains } from "./test-skeleton.js";

describe("the skeleton's chains", () => {
  it.each(
    chainRegistryContract({
      create: () => ({
        registry: skeletonChains(),
        known: chainRefSchema.parse(bsc.id),
        unknown: chainRefSchema.parse("eip155:1"),
      }),
    }),
  )("follow the chain registry contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
