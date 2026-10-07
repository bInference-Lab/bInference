import { chainRefSchema } from "@binference/chain";
import { chainRegistryContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "./open-engine-parts.js";

describe("the self-hosted chains", () => {
  it.each(
    chainRegistryContract({
      create: () => ({
        registry: selfHostedChains(),
        known: chainRefSchema.parse("eip155:56"),
        unknown: chainRefSchema.parse("eip155:1"),
      }),
    }),
  )("follow the chain registry contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
