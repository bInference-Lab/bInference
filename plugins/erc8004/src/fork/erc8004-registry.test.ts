import { bscContract, type Fork, withFork } from "@binference/chain-evm/fork";
import {
  type AccountRef,
  accountRefSchema,
  type IdentityRegistry,
  isTxHash,
  type LandedRegistration,
  type Result,
  type SimulatedStep,
  type TxDraft,
  type TxHash,
} from "@binference/plugin-sdk";
import { decodeEvmDraft, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { identityRegistryContract } from "@binference/plugin-sdk/testing";
import { type Address, getAddress, keccak256, stringToHex, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { createErc8004Registry, erc8004TestedVersion } from "../erc8004-registry.js";

// The ERC-8004 identity registry on a fork of BSC at the suite's pinned block: anvil's first
// account registers, and a fresh address stands for another wallet. Nothing is reached but the
// fork.
const registryAddress = bscContract("erc8004", "identity-registry");
const other = getAddress(keccak256(stringToHex("binference fork other")).slice(0, 42));

function refOf(fork: Fork, address: Address): AccountRef {
  return accountRefSchema.parse(`${fork.chain.ref}:${address}`);
}

function registryOn(fork: Fork): IdentityRegistry {
  const contracts = { "identity-registry": refOf(fork, registryAddress) };
  return createErc8004Registry({ chain: fork.chain.ref, rpc: fork.rpc, contracts });
}

async function land(fork: Fork, draft: TxDraft): Promise<TxHash> {
  const call = decodeEvmDraft(draft);
  if (!call.ok) {
    throw new Error("The draft is no EVM call.");
  }
  const { from, to, value, data } = call.value;
  const receipt = await fork.send({ from, to, value, data, gas: 1_000_000n });
  if (!isTxHash(receipt.transactionHash)) {
    throw new Error("anvil answered a malformed hash.");
  }
  return receipt.transactionHash;
}

// Runs the draft on the fork and undoes it, reading its logs as a simulator reports them.
async function simulate(fork: Fork, draft: TxDraft): Promise<SimulatedStep> {
  const snapshot = await fork.call("evm_snapshot", []);
  try {
    const hash = await land(fork, draft);
    const receipt = await fork.client.getTransactionReceipt({ hash: hash as `0x${string}` });
    return {
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      transfers: [],
      approvals: [],
      logs: receipt.logs.map((log) => ({
        emitter: refOf(fork, getAddress(log.address)),
        topics: log.topics,
        data: log.data,
      })),
    };
  } finally {
    await fork.call("evm_revert", [snapshot]);
  }
}

function idOf(landed: Result<LandedRegistration, "not_found">): bigint {
  if (!landed.ok) {
    throw new Error("The registration was not read back.");
  }
  return BigInt(landed.value.onchainId);
}

describe("the ERC-8004 identity registry on a fork of BSC", () => {
  const open: { fork?: Fork } = {};
  const checks = identityRegistryContract({
    create: async () => {
      const { fork } = open;
      if (fork === undefined) {
        throw new Error("No fork is open.");
      }
      await fork.call("anvil_setBalance", [other, toHex(10n ** 18n)]);
      return {
        registry: registryOn(fork),
        wallet: refOf(fork, fork.account),
        other: refOf(fork, other),
        foreign: encodeEvmDraft({
          from: refOf(fork, fork.account),
          to: refOf(fork, other),
          value: 0n,
          data: "0x",
        }),
        simulate: async (draft) => simulate(fork, draft),
        land: async (draft) => land(fork, draft),
      };
    },
  });

  it.for(checks)("follows the contract: $name", async ({ run }, { signal }) => {
    await withFork(signal, async (fork) => {
      open.fork = fork;
      await expect(run()).resolves.toBeUndefined();
    });
  });

  it("runs the version the plugin was tested with, and reads a registered file back whole", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      const registry = registryOn(fork);
      const wallet = refOf(fork, fork.account);
      const standing = await registry.standing(wallet, { signal });
      expect(standing).toStrictEqual({ version: erc8004TestedVersion, held: 0n });
      const card = { name: "Fork scout", description: "Reads dips", wallet, version: "0.0.0" };
      const file = registry.fileOf(card);
      const txHash = await land(fork, registry.build({ wallet, file }));
      const landed = await registry.landed({ wallet, txHash }, { signal });
      expect(landed).toMatchObject({ ok: true, value: { owner: wallet, file } });
      const id = idOf(landed);
      const agentWallet = await fork.client.readContract({
        address: registryAddress,
        abi: [
          {
            type: "function",
            name: "getAgentWallet",
            inputs: [{ name: "agentId", type: "uint256" }],
            outputs: [{ name: "", type: "address" }],
            stateMutability: "view",
          },
        ],
        functionName: "getAgentWallet",
        args: [id],
      });
      expect(agentWallet).toBe(fork.account);
    });
  });
});
