import { describe, expect, it } from "vitest";
import { chainRefSchema } from "../caip/chain-ref.js";
import { chainRegistryContract } from "../contracts/chain-registry-contract.js";
import { createFakeChainDefinition } from "../fakes/fake-chain.js";
import { createFakeFamily } from "../fakes/fake-family.js";
import { createFakeSigningScheme } from "../fakes/fake-signing-scheme.js";
import type { ChainDefinition } from "./chain-definition.js";
import { createChainRegistry } from "./create-chain-registry.js";

function registryOf(chains: readonly ChainDefinition[]) {
  return createChainRegistry({
    chains,
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

const valid = createFakeChainDefinition();

describe("chain registry", () => {
  it.each(
    chainRegistryContract({
      create: () => ({
        registry: registryOf([valid]),
        known: chainRefSchema.parse(valid.id),
        unknown: chainRefSchema.parse("fake:2"),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each<[string, ChainDefinition, string]>([
    ["data that breaks the schema", { ...valid, blockTimeMs: -1 }, "chain.bad_definition"],
    ["an unknown family", { ...valid, family: "other" }, "chain.bad_definition"],
    ["another namespace", { ...valid, id: "fakes:1" }, "chain.bad_definition"],
    [
      "an address outside the canonical form",
      { ...valid, contracts: [{ ...valid.contracts[0], address: "0x0000000B" }] },
      "chain.bad_definition",
    ],
  ] as [string, ChainDefinition, string][])("refuses %s", (_case, definition, code) => {
    expect(() => registryOf([definition])).toThrow(expect.objectContaining({ code }));
  });

  it("refuses two chains with one id", () => {
    expect(() => registryOf([valid, { ...valid, key: "fake-two" }])).toThrow(
      expect.objectContaining({ code: "chain.duplicate_chain" }),
    );
  });
});
