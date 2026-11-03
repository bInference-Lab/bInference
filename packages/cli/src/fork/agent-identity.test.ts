import { accountRefSchema } from "@binference/chain";
import { bscContract, type Fork, withFork } from "@binference/chain-evm/fork";
import type { IdentityRegistry } from "@binference/chain/identity";
import { BinferenceError, type Id } from "@binference/core";
import { createErc8004Registry } from "@binference/erc8004";
import type { ResultOf } from "@binference/protocol";
import { parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { startMining } from "./executor-rig.js";
import { rescueAgents } from "./rescue-rig-parts.js";
import { type RescueRig, rescueRigOf } from "./rescue-rig.js";
import {
  cardTextOf,
  confirmOn,
  endedStates,
  expectValue,
  ownerCall,
  reachOn,
} from "./rig-calls.js";
import { fundedMain } from "./stake-rig-steps.js";

// An agent's registration in BSC's ERC-8004 identity registry through the engine and its
// executor on a fork of BSC: its card, the owner's tap, the main wallet's signature, and the
// registration file read back from the registry. A second registration is refused before a card.
const registryAddress = bscContract("erc8004", "identity-registry");
const tokenUri = parseAbi(["function tokenURI(uint256 tokenId) view returns (string)"]);
const [rigAgent] = rescueAgents;
const description = "Buys dips on BSC";
const filePrefix = "data:application/json;base64,";

function registryOn(fork: Fork): IdentityRegistry {
  const ref = accountRefSchema.parse(`${fork.chain.ref}:${registryAddress}`);
  return createErc8004Registry({
    chain: fork.chain.ref,
    rpc: fork.rpc,
    contracts: { "identity-registry": ref },
  });
}

function agentOf(): Id<"agt"> {
  if (rigAgent === undefined) {
    throw new BinferenceError({ code: "fork.no_agent", message: "The rig has no agent." });
  }
  return rigAgent;
}

// The registration binference holds, which must be there.
function registered(held: ResultOf<"identity/get">) {
  if (held.registration === undefined) {
    throw new BinferenceError({ code: "fork.no_identity", message: "No identity was stored." });
  }
  return held.registration;
}

// The main wallet's stored ceiling, holding the registry's one call, as `ceiling set` writes it.
async function holdRegisterCall(rig: RescueRig, registry: IdentityRegistry, wallet: Id<"wal">) {
  const record = rig.stores.install.walletNow(wallet);
  const abi = registry.contracts.flatMap(({ calls }) => (calls ?? []).map((call) => call.abi));
  if (record === undefined) {
    throw new BinferenceError({ code: "fork.no_wallet", message: "The rig has no main wallet." });
  }
  const ceiling = { ...record.ceiling, policy: [{ abi }] };
  await rig.stores.install.updateCeiling(
    { wallet: record.id, ceiling },
    { signal: AbortSignal.timeout(5_000) },
  );
}

// The registration file the registry holds for an agent id, as JSON.
async function fileOn(fork: Fork, onchainId: string): Promise<unknown> {
  const uri = await fork.client.readContract({
    address: registryAddress,
    abi: tokenUri,
    functionName: "tokenURI",
    args: [BigInt(onchainId)],
  });
  expect(uri.startsWith(filePrefix)).toBe(true);
  return JSON.parse(Buffer.from(uri.slice(filePrefix.length), "base64").toString("utf8"));
}

describe("an agent's identity through the engine on the BSC fork", () => {
  it("registers the agent with one tap, reads its card back, and refuses a second", async ({
    signal,
  }) => {
    const agent = agentOf();
    await withFork(signal, async (fork) => {
      const registry = registryOn(fork);
      const rig = await rescueRigOf(fork, { identityRegistries: [registry] });
      const main = await fundedMain(fork, rig);
      await holdRegisterCall(rig, registry, main.wallet);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      try {
        const register = rig.engine.handlers["identity/register"];
        const view = expectValue(await register(ownerCall({ agent, description }, signal)));
        expect([view.state, view.outcome?.reason]).toStrictEqual([
          "awaiting_confirmation",
          undefined,
        ]);
        const lines = await cardTextOf(rig, view, signal);
        await confirmOn(rig, view, signal);
        expect(await reachOn(rig, view.intent, endedStates)).toBe("reconciled");

        const held = await rig.engine.handlers["identity/get"](ownerCall({ agent }, signal));
        const registration = registered(expectValue(held));
        expect(registration.registry).toBe(`${fork.chain.ref}:${registryAddress}`);
        const file = await fileOn(fork, registration.onchainId);
        expect(file).toMatchObject({
          type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
          name: "rescue 0",
          description,
          services: [
            { name: "wallet", endpoint: `${fork.chain.ref}:${main.address}` },
            { name: "binference", version: "fork" },
          ],
          registrations: [],
          active: true,
        });
        expect(registration.file).toMatch(/^data:application\/json;base64,/u);
        expect(lines.join("\n")).toContain(description);

        const again = await register(ownerCall({ agent, description }, signal));
        expect(again).toStrictEqual({ ok: false, error: "intent.identity_exists" });
      } finally {
        miner.abort();
        await mining;
      }
    });
  });
});
