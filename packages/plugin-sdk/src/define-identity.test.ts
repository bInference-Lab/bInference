import { accountRefSchema, chainRefSchema } from "@binference/chain";
import type { IdentityRegistry } from "@binference/chain/identity";
import { createFakeIdentityRegistry, fakeDraft } from "@binference/chain/testing";
import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { defineIdentity } from "./define-identity.js";
import { identityRegistryContract } from "./testing.js";

const chain = chainRefSchema.parse("fake:1");
const wallet = accountRefSchema.parse("fake:1:0x000000a1");
const other = accountRefSchema.parse("fake:1:0x000000a2");

function fake() {
  return createFakeIdentityRegistry({ chain, address: "0x000000e1" });
}

function refusalOf(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof BinferenceError ? error.code : error;
  }
}

describe("defineIdentity", () => {
  it.each(
    identityRegistryContract({
      create: async () => {
        const inner = fake();
        return await Promise.resolve({
          registry: defineIdentity(inner),
          wallet,
          other,
          foreign: fakeDraft(wallet, { to: "0x000000f1", value: 0n, data: "register,data%3A" }),
          simulate: async (draft) => Promise.resolve(inner.simulate(draft)),
          land: async (draft) => Promise.resolve(inner.land(draft)),
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("freezes the registry it defines", () => {
    const defined = defineIdentity(fake());
    expect(Object.isFrozen(defined)).toBe(true);
    expect([defined.id, defined.testedVersion]).toStrictEqual(["fake-identity", "2.0.0"]);
  });

  const base = fake();
  const elsewhere = chainRefSchema.parse("fake:2");
  it.each<[string, IdentityRegistry]>([
    ["no contracts", { ...base, contracts: [] }],
    ["a contract on another chain", { ...base, contracts: [{ chain: elsewhere, names: ["r"] }] }],
    ["a spender", { ...base, contracts: [{ chain, names: ["r"], spenders: ["r"] }] }],
    ["a registry on another chain", { ...base, registry: accountRefSchema.parse("fake:2:0x01") }],
    ["a malformed id", { ...base, id: "Not Kebab" }],
  ])("refuses a declaration with %s as it loads", (_name, definition) => {
    expect(refusalOf(() => defineIdentity(definition))).toBe("plugin.bad_venue");
  });
});
