import { type AccountRef, accountRefSchema } from "@binference/chain";
import { createEvmFamily } from "@binference/chain-evm";
import { bscContract, type Fork, withFork } from "@binference/chain-evm/fork";
import { recheckName } from "@binference/engine/sends";
import { createSpaceIdResolver } from "@binference/spaceid";
import {
  type PlacementStep,
  pointStep,
  readPlacementParts,
  registerSteps,
} from "@binference/spaceid/testing";
import { type Address, getAddress, keccak256, stringToHex, toHex } from "viem";
import { describe, expect, it } from "vitest";

// A send by name's second read on a BSC fork: a name placed as SPACE ID's controllers and its
// holder place one, read once for the card, then read again by the engine's check before signing.
const contracts = {
  registry: bscContract("spaceid", "registry"),
  registrar: bscContract("spaceid", "base-registrar"),
};
const holder = accountOf("binference recheck holder");
const later = accountOf("binference recheck later");
const name = "binference-recheck.bnb";

function accountOf(phrase: string): Address {
  return getAddress(keccak256(stringToHex(phrase)).slice(0, 42));
}

function refOf(fork: Fork, address: Address): AccountRef {
  return accountRefSchema.parse(`${fork.chain.ref}:${address}`);
}

async function sendOne(fork: Fork, step: PlacementStep): Promise<void> {
  await fork.call("anvil_impersonateAccount", [step.from]);
  await fork.call("anvil_setBalance", [step.from, toHex(10n ** 18n)]);
  expect((await fork.send(step)).status).toBe("success");
}

async function send(fork: Fork, steps: readonly PlacementStep[]): Promise<void> {
  for (const step of steps) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step needs the one before it
    await sendOne(fork, step);
  }
}

async function placed(fork: Fork, signal: AbortSignal) {
  const parts = await readPlacementParts(contracts, { rpc: fork.rpc, signal });
  await send(fork, registerSteps(parts, { label: "binference-recheck", holder, address: holder }));
  const resolver = createSpaceIdResolver({
    chain: fork.chain.ref,
    rpc: fork.rpc,
    contracts: {
      registry: refOf(fork, contracts.registry),
      "base-registrar": refOf(fork, contracts.registrar),
    },
  });
  return { parts, resolver };
}

describe("a send by name read again on a fork of BSC", () => {
  const family = createEvmFamily();

  it("passes a name that still points to its card's address", async ({ signal }) => {
    await withFork(signal, async (fork) => {
      const { resolver } = await placed(fork, signal);
      const card = await resolver.resolve(name, { signal });
      expect(card).toMatchObject({ kind: "found", address: refOf(fork, holder) });
      const recheck = recheckName(
        resolver,
        { name, address: refOf(fork, holder) },
        { family, signal },
      );
      await expect(recheck).resolves.toStrictEqual({ kind: "same" });
    });
  });

  it("refuses a name whose record changed after its card", async ({ signal }) => {
    await withFork(signal, async (fork) => {
      const { parts, resolver } = await placed(fork, signal);
      await expect(resolver.resolve(name, { signal })).resolves.toMatchObject({
        address: refOf(fork, holder),
      });
      await send(fork, [pointStep(parts, { name, holder, address: later })]);
      const recheck = recheckName(
        resolver,
        { name, address: refOf(fork, holder) },
        { family, signal },
      );
      await expect(recheck).resolves.toStrictEqual({ kind: "moved", now: refOf(fork, later) });
    });
  });
});
