import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type NameResolution,
  type NameResolver,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import { nameResolverContract } from "@binference/plugin-sdk/testing";
import { type Address, getAddress, keccak256, stringToHex, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { createSpaceIdResolver } from "../space-id-resolver.js";
import {
  type PlacementParts,
  type PlacementStep,
  pointStep,
  readPlacementParts,
  registerSteps,
  reverseSteps,
} from "../testing.js";

// Names placed on a BSC fork the way SPACE ID's own controllers and a holder place them: the base
// registrar's owner registers a label, the holder names the resolver SPACE ID's own name uses and
// sets its address, and the address sets its reverse record. Nothing is reached but the fork.
const contracts = {
  registry: bscContract("spaceid", "registry"),
  registrar: bscContract("spaceid", "base-registrar"),
};
const person = accountOf("binference fork person");
const other = accountOf("binference fork other");
const wbnb = bscToken("WBNB");

interface Placed {
  readonly fork: Fork;
  readonly resolver: NameResolver;
  readonly parts: PlacementParts;
}

// A fresh address no one holds a key for, made from a phrase.
function accountOf(phrase: string): Address {
  return getAddress(keccak256(stringToHex(phrase)).slice(0, 42));
}

function refOf(fork: Fork, address: Address): AccountRef {
  return accountRefSchema.parse(`${fork.chain.ref}:${address}`);
}

function addressOf(ref: AccountRef): Address {
  const parsed = parseEvmAddress(accountRefParts(ref).address);
  if (!parsed.ok) {
    throw new Error(`${ref} names no EVM address.`);
  }
  return parsed.value;
}

function contractOf(answer: NameResolution): Address {
  if (answer.kind !== "contract") {
    throw new Error(`The name resolved as ${answer.kind}, not as a contract.`);
  }
  return addressOf(answer.address);
}

async function sendOne(fork: Fork, step: PlacementStep): Promise<void> {
  await fork.call("anvil_impersonateAccount", [step.from]);
  await fork.call("anvil_setBalance", [step.from, toHex(10n ** 18n)]);
  const receipt = await fork.send(step);
  expect(receipt.status).toBe("success");
}

async function send(fork: Fork, steps: readonly PlacementStep[]): Promise<void> {
  for (const step of steps) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step needs the one before it
    await sendOne(fork, step);
  }
}

// `binference-person.bnb` points to a fresh address whose reverse record names it, and
// `binference-vault.bnb` to WBNB, a contract.
async function placedOn(fork: Fork, signal: AbortSignal): Promise<Placed> {
  const parts = await readPlacementParts(contracts, { rpc: fork.rpc, signal });
  await send(fork, [
    ...registerSteps(parts, { label: "binference-person", holder: person, address: person }),
    ...reverseSteps(parts, { address: person, name: "binference-person.bnb" }),
    ...registerSteps(parts, { label: "binference-vault", holder: person, address: wbnb }),
  ]);
  const resolver = createSpaceIdResolver({
    chain: fork.chain.ref,
    rpc: fork.rpc,
    contracts: {
      registry: refOf(fork, contracts.registry),
      "base-registrar": refOf(fork, contracts.registrar),
    },
  });
  return { fork, resolver, parts };
}

describe("bnb names on a fork of BSC", () => {
  const open: { placed?: Placed } = {};
  const checks = nameResolverContract({
    create: async () => {
      const { placed } = open;
      if (placed === undefined) {
        throw new Error("No fork is open.");
      }
      const { fork, resolver, parts } = placed;
      return await Promise.resolve({
        resolver,
        person: { name: "binference-person.bnb", address: refOf(fork, person) },
        contract: { name: "binference-vault.bnb", address: refOf(fork, wbnb) },
        unregistered: "binference-nobody-registered-this.bnb",
        malformed: "binference_person.bnb",
        elsewhere: refOf(fork, other),
        move: async (to) => {
          const name = "binference-person.bnb";
          await send(fork, [pointStep(parts, { name, holder: person, address: addressOf(to) })]);
        },
      });
    },
  });

  it.for(checks)("follows the contract: $name", async ({ run }, { signal }) => {
    await withFork(signal, async (fork) => {
      open.placed = await placedOn(fork, signal);
      await expect(run()).resolves.toBeUndefined();
    });
  });

  // SPACE ID's own address delegates its code by EIP-7702 (read 2026-10-31): it holds code, so a
  // send by name refuses it as it refuses any account with code.
  it("refuses SPACE ID's own name, whose address holds a delegation's code", async ({ signal }) => {
    await withFork(signal, async (fork) => {
      const { resolver } = await placedOn(fork, signal);
      const answer = await resolver.resolve("SpaceID.bnb", { signal });
      expect(answer).toMatchObject({ kind: "contract", name: "spaceid.bnb" });
      const code = await fork.client.getCode({ address: contractOf(answer) });
      expect(code?.startsWith("0xef0100")).toBe(true);
    });
  });

  it("names the other name when the address's reverse record points elsewhere", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      const placed = await placedOn(fork, signal);
      const alias = { label: "binference-alias", holder: person, address: person };
      await send(fork, registerSteps(placed.parts, alias));
      await expect(
        placed.resolver.resolve("binference-alias.bnb", { signal }),
      ).resolves.toStrictEqual({
        kind: "found",
        name: "binference-alias.bnb",
        address: refOf(fork, person),
        reverse: { kind: "differs", other: "binference-person.bnb" },
      });
    });
  });
});
