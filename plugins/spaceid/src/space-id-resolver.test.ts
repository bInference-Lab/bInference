import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  chainRefSchema,
  type NameResolver,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import { nameResolverContract } from "@binference/plugin-sdk/testing";
import { type Address, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { createSpaceIdResolver } from "./space-id-resolver.js";
import {
  createSpaceIdWorld,
  registrarAddress,
  registryAddress,
  reverseNameOf,
  type SpaceIdWorld,
} from "./testing/space-id-world.js";

const chain = chainRefSchema.parse("eip155:56");
const now = 1_800_000_000n;
const year = 31_536_000n;
// The resolvers the registry named on chain for spaceid.bnb and for its address's reverse record.
const publicResolver: Address = "0x7A18768EdB2619e73c4d5067B90Fd84a71993C1D";
const reverseResolver: Address = "0x1DdA6feF836c0c1dE986aC15597922dEe95Ff98A";
const alice: Address = "0x1111111111111111111111111111111111110001";
const bob: Address = "0x1111111111111111111111111111111111110002";
const vault: Address = "0x55d398326f99059fF775485246999027B3197955";
const smart: Address = "0x1111111111111111111111111111111111110003";
// An EIP-7702 designator naming the delegate SPACE ID's own address uses on BSC.
const designator = "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b";
const live = { signal: new AbortController().signal };

const account = (address: Address): AccountRef => accountRefSchema.parse(`${chain}:${address}`);
const contracts = {
  registry: account(registryAddress),
  "base-registrar": account(registrarAddress),
};

function placeName(world: SpaceIdWorld, label: string, address: Address): void {
  world.register(label, now + year);
  world.setResolver(`${label}.bnb`, publicResolver);
  world.setAddress(publicResolver, `${label}.bnb`, address);
}

function setReverse(world: SpaceIdWorld, address: Address, name: string): void {
  world.setResolver(reverseNameOf(address), reverseResolver);
  world.setReverseName(reverseResolver, address, name);
}

function testbed(): { readonly world: SpaceIdWorld; readonly resolver: NameResolver } {
  const world = createSpaceIdWorld(now);
  placeName(world, "alice", alice);
  setReverse(world, alice, "alice.bnb");
  placeName(world, "vault", vault);
  world.setCode(vault);
  placeName(world, "smart", smart);
  world.setCode(smart, designator);
  return { world, resolver: createSpaceIdResolver({ chain, rpc: world.rpc, contracts }) };
}

describe("the bnb name resolver", () => {
  it.each(
    nameResolverContract({
      create: async () => {
        const { world, resolver } = testbed();
        return await Promise.resolve({
          resolver,
          person: { name: "alice.bnb", address: account(alice) },
          smartAccount: { name: "smart.bnb", address: account(smart) },
          contract: { name: "vault.bnb", address: account(vault) },
          unregistered: "nobody.bnb",
          malformed: "a_b.bnb",
          elsewhere: account(bob),
          move: async (to) => {
            world.setAddress(publicResolver, "alice.bnb", accountAddress(to));
            await Promise.resolve();
          },
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a registration that ended by the latest block's time, and its subnames", async () => {
    const { world, resolver } = testbed();
    placeName(world, "pay.alice", alice);
    world.register("alice", now);
    const answers = await Promise.all(
      ["alice.bnb", "pay.alice.bnb"].map(async (name) => resolver.resolve(name, live)),
    );
    expect(answers).toStrictEqual([
      { kind: "not_found", name: "alice.bnb" },
      { kind: "not_found", name: "pay.alice.bnb" },
    ]);
    world.setTime(now - 1n);
    await expect(resolver.resolve("alice.bnb", live)).resolves.toMatchObject({ kind: "found" });
  });

  it("refuses an address whose code is a designator with more after it", async () => {
    const { world, resolver } = testbed();
    world.setCode(smart, `${designator}00`);
    await expect(resolver.resolve("smart.bnb", live)).resolves.toStrictEqual({
      kind: "contract",
      name: "smart.bnb",
      address: account(smart),
    });
  });

  it("finds nothing for a name with no resolver, no addr, or the zero address", async () => {
    const { world, resolver } = testbed();
    placeName(world, "zero", zeroAddress);
    world.register("bare", now + year);
    placeName(world, "odd", alice);
    world.setResolver("odd.bnb", bob);
    world.breakContract(bob);
    const names = ["zero.bnb", "bare.bnb", "odd.bnb"];
    const answers = await Promise.all(names.map(async (name) => resolver.resolve(name, live)));
    expect(answers).toStrictEqual(names.map((name) => ({ kind: "not_found", name })));
  });

  it("reads the reverse record through the resolver the registry names for it", async () => {
    const { world, resolver } = testbed();
    placeName(world, "bob", bob);
    await expect(resolver.resolve("bob.bnb", live)).resolves.toMatchObject({
      reverse: { kind: "none" },
    });
    setReverse(world, bob, "");
    await expect(resolver.resolve("bob.bnb", live)).resolves.toMatchObject({
      reverse: { kind: "none" },
    });
    setReverse(world, bob, "Bob.bnb");
    await expect(resolver.resolve("bob.bnb", live)).resolves.toMatchObject({
      reverse: { kind: "matches" },
    });
    setReverse(world, bob, "binance.bnb");
    await expect(resolver.resolve("bob.bnb", live)).resolves.toMatchObject({
      reverse: { kind: "differs", other: "binance.bnb" },
    });
  });

  it("leaves the reverse record out when its resolver answers no name", async () => {
    const { world, resolver } = testbed();
    world.breakContract(reverseResolver);
    await expect(resolver.resolve("alice.bnb", live)).resolves.toStrictEqual({
      kind: "found",
      name: "alice.bnb",
      address: account(alice),
    });
  });

  it("reads nothing for text that is no name it resolves", async () => {
    const { world, resolver } = testbed();
    await expect(resolver.resolve("alice.eth", live)).resolves.toStrictEqual({ kind: "malformed" });
    expect(world.asked()).toStrictEqual([]);
  });

  it("reads the latest block first, then every record at it", async () => {
    const { world, resolver } = testbed();
    await resolver.resolve("alice.bnb", live);
    expect(world.asked()).toStrictEqual([
      "eth_getBlockByNumber",
      "eth_call",
      "eth_call",
      "eth_call",
      "eth_getCode",
      "eth_call",
      "eth_call",
    ]);
  });

  it("rejects when no node answers, or the registry answers outside its shape", async () => {
    const down = testbed();
    down.world.down();
    await expect(down.resolver.resolve("alice.bnb", live)).rejects.toMatchObject({
      code: "chain.rpc_down",
    });
    const broken = testbed();
    broken.world.breakContract(registryAddress);
    await expect(broken.resolver.resolve("alice.bnb", live)).rejects.toMatchObject({
      code: "spaceid.read_failed",
    });
  });

  it("refuses options without its contracts, or with another chain's", () => {
    const rpc = createSpaceIdWorld(now).rpc;
    const foreign = accountRefSchema.parse(`eip155:1:${registrarAddress}`);
    for (const given of [
      { registry: contracts.registry },
      { ...contracts, "base-registrar": foreign },
    ]) {
      expect(() => createSpaceIdResolver({ chain, rpc, contracts: given })).toThrow(
        expect.objectContaining({ code: "spaceid.bad_options" }),
      );
    }
  });
});

// The address of an account of the resolver's chain.
function accountAddress(ref: AccountRef): Address {
  const parsed = parseEvmAddress(accountRefParts(ref).address);
  if (!parsed.ok) {
    throw new Error(`${ref} names no EVM address.`);
  }
  return parsed.value;
}
