import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { nameResolverContract } from "../contracts/name-resolver-contract.js";
import { createFakeNameResolver } from "./fake-name-resolver.js";

const chain = chainRefSchema.parse("fake:1");
const person = accountRefSchema.parse("fake:1:0x000000a1");
const contract = accountRefSchema.parse("fake:1:0x000000c1");
const elsewhere = accountRefSchema.parse("fake:1:0x000000b2");
const live = { signal: new AbortController().signal };

function resolverWithRecords() {
  const resolver = createFakeNameResolver({ chain, suffix: ".fake" });
  resolver.set("alice.fake", { address: person });
  resolver.set("vault.fake", { address: contract, isContract: true });
  return resolver;
}

describe("fake name resolver", () => {
  it.each(
    nameResolverContract({
      create: async () => {
        const resolver = resolverWithRecords();
        return await Promise.resolve({
          resolver,
          person: { name: "alice.fake", address: person },
          contract: { name: "vault.fake", address: contract },
          unregistered: "nobody.fake",
          malformed: "a_b.fake",
          elsewhere,
          move: async (to) => {
            resolver.set("alice.fake", { address: to });
            await Promise.resolve();
          },
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("answers the reverse record a test sets, or none read, and forgets a removed name", async () => {
    const resolver = resolverWithRecords();
    resolver.set("alice.fake", {
      address: person,
      reverse: { kind: "differs", other: "bob.fake" },
    });
    await expect(resolver.resolve("alice.fake", live)).resolves.toMatchObject({
      reverse: { kind: "differs", other: "bob.fake" },
    });
    resolver.set("alice.fake", { address: person, reverse: "unread" });
    await expect(resolver.resolve("alice.fake", live)).resolves.toStrictEqual({
      kind: "found",
      name: "alice.fake",
      address: person,
    });
    resolver.set("alice.fake", undefined);
    await expect(resolver.resolve("alice.fake", live)).resolves.toStrictEqual({
      kind: "not_found",
      name: "alice.fake",
    });
  });

  it("rejects every read while down, counts each, and answers again once up", async () => {
    const resolver = resolverWithRecords();
    resolver.down();
    await expect(resolver.resolve("alice.fake", live)).rejects.toMatchObject({
      code: "chain.rpc_down",
      retryable: true,
    });
    resolver.up();
    await expect(resolver.resolve("alice.fake", live)).resolves.toMatchObject({ kind: "found" });
    expect(resolver.reads()).toBe(2);
  });

  it("refuses a record on another chain", () => {
    const resolver = resolverWithRecords();
    const stranger = accountRefSchema.parse("fake:2:0x000000a1");
    expect(() => {
      resolver.set("alice.fake", { address: stranger });
    }).toThrow("its resolver's chain");
  });
});
