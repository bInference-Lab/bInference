import { chainRefSchema } from "@binference/chain";
import { chainRegistryContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { testChains } from "./test-engine.js";

describe("the test engine's parts", () => {
  it.each(
    chainRegistryContract({
      create: () => ({
        registry: testChains(),
        known: chainRefSchema.parse("fake:1"),
        unknown: chainRefSchema.parse("fake:2"),
      }),
    }),
  )("hold the fake chain by the registry contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
