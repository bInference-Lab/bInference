import { chainRefSchema } from "@binference/chain";
import { chainRegistryContract, createFakeChainDefinition } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { testChains } from "./test-command-bot.js";

describe("the command tests' chains", () => {
  it.each(
    chainRegistryContract({
      create: () => ({
        registry: testChains(),
        known: chainRefSchema.parse(createFakeChainDefinition().id),
        unknown: chainRefSchema.parse("fake:2"),
      }),
    }),
  )("follow the chain registry contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
