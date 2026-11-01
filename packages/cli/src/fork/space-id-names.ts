import { type AccountRef, accountRefSchema } from "@binference/chain";
import { bscContract, type Fork } from "@binference/chain-evm/fork";
import { BinferenceError } from "@binference/core";
import { createSpaceIdResolver } from "@binference/spaceid";
import {
  type PlacementParts,
  type PlacementStep,
  readPlacementParts,
  registerSteps,
} from "@binference/spaceid/testing";
import { type Address, toHex } from "viem";

const contracts = {
  registry: bscContract("spaceid", "registry"),
  registrar: bscContract("spaceid", "base-registrar"),
};

/**
 * Sends each step on the fork as its sender, in order, each sender funded with 1 BNB; a step that
 * reverts is a fault.
 */
export async function sendAs(fork: Fork, steps: readonly PlacementStep[]): Promise<void> {
  for (const step of steps) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step needs the one before it
    await fork.call("anvil_impersonateAccount", [step.from]);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step needs the one before it
    await fork.call("anvil_setBalance", [step.from, toHex(10n ** 18n)]);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step needs the one before it
    const receipt = await fork.send(step);
    if (receipt.status !== "success") {
      throw new BinferenceError({
        code: "fork.step_failed",
        message: "A placement step reverted.",
      });
    }
  }
}

/**
 * Registers `<label>.bnb` on the fork as SPACE ID's controllers do, held by `holder` and pointing
 * to `address`, and answers the parts a later step needs.
 */
export async function placeName(
  fork: Fork,
  name: { readonly label: string; readonly holder: Address; readonly address: Address },
  signal: AbortSignal,
): Promise<PlacementParts> {
  const parts = await readPlacementParts(contracts, { rpc: fork.rpc, signal });
  await sendAs(fork, registerSteps(parts, name));
  return parts;
}

/** SPACE ID's resolver of `.bnb` names on the fork, over the registry's contracts. */
export function spaceIdOn(fork: Fork): ReturnType<typeof createSpaceIdResolver> {
  const refOf = (address: Address): AccountRef =>
    accountRefSchema.parse(`${fork.chain.ref}:${address}`);
  return createSpaceIdResolver({
    chain: fork.chain.ref,
    rpc: fork.rpc,
    contracts: {
      registry: refOf(contracts.registry),
      "base-registrar": refOf(contracts.registrar),
    },
  });
}
