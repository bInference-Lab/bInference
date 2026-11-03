import {
  accountRefSchema,
  BinferenceError,
  chainRefSchema,
  type IdentityRegistry,
} from "@binference/plugin-sdk";
import { encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { identityRegistryContract } from "@binference/plugin-sdk/testing";
import { encodeFunctionData, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { createErc8004Registry, erc8004Declaration } from "./erc8004-registry.js";
import { createRegistryWorld, registryAddress } from "./testing.js";

const chain = chainRefSchema.parse("eip155:56");
const wallet = accountRefSchema.parse("eip155:56:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
const other = accountRefSchema.parse("eip155:56:0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359");
const registryRef = accountRefSchema.parse(`eip155:56:${registryAddress}`);
const live = { signal: new AbortController().signal };
const card = { name: "Scout", description: "Buys dips", wallet, version: "2026.11.3" };

function setup() {
  const world = createRegistryWorld(chain);
  const contracts = { "identity-registry": registryRef };
  const registry = createErc8004Registry({ chain, rpc: world.rpc, contracts });
  return { world, registry };
}

function codeOf(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof BinferenceError ? error.code : error;
  }
}

function draftTo(to: string, data: `0x${string}`, value = 0n) {
  return encodeEvmDraft({
    from: wallet,
    to: accountRefSchema.parse(`eip155:56:${to}`),
    value,
    data,
  });
}

function decodedFile(registry: IdentityRegistry): string {
  const file = registry.fileOf(card);
  return Buffer.from(file.slice("data:application/json;base64,".length), "base64").toString("utf8");
}

describe("createErc8004Registry", () => {
  it.each(
    identityRegistryContract({
      create: async () => {
        const { world, registry } = setup();
        return await Promise.resolve({
          registry,
          wallet,
          other,
          foreign: draftTo(other.slice("eip155:56:".length), "0x"),
          simulate: async (draft) => Promise.resolve(world.simulate(draft)),
          land: async (draft) => Promise.resolve(world.land(draft)),
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("writes the registration file decision 0334 sets, as base64 JSON", () => {
    const { registry } = setup();
    expect(registry.fileOf(card)).toMatch(/^data:application\/json;base64,[A-Za-z0-9+/]+=*$/);
    expect(JSON.parse(decodedFile(registry))).toStrictEqual({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Scout",
      description: "Buys dips",
      image: "",
      services: [
        { name: "wallet", endpoint: wallet },
        {
          name: "binference",
          endpoint: "https://www.npmjs.com/package/binference",
          version: "2026.11.3",
        },
      ],
      x402Support: false,
      active: true,
      registrations: [],
      supportedTrust: [],
    });
  });

  it("decodes only register(string) to the registry, with no coin, in its exact bytes", () => {
    const { registry } = setup();
    const own = registry.build({ wallet, file: "data:," });
    const withMetadata = encodeFunctionData({
      abi: [parseAbiItem("function register(string agentURI, (string,bytes)[] metadata)")],
      args: ["data:,", []],
    });
    const bare = encodeFunctionData({ abi: [parseAbiItem("function register()")] });
    const plain = encodeFunctionData({
      abi: [parseAbiItem("function register(string agentURI)")],
      args: ["data:,"],
    });
    const refused = [
      draftTo(registryAddress, plain, 1n),
      draftTo(registryAddress, withMetadata),
      draftTo(registryAddress, bare),
      draftTo(registryAddress, `${plain}00`),
      draftTo(other.slice("eip155:56:".length), plain),
      { ...own, chain: chainRefSchema.parse("eip155:1") },
    ];
    expect(registry.decode(own)).toStrictEqual({ ok: true, value: { file: "data:," } });
    expect(refused.map((draft) => registry.decode(draft).ok)).toStrictEqual(
      refused.map(() => false),
    );
  });

  it("reads a reverted registration as not found, and a moved identity's holder now", async () => {
    const { world, registry } = setup();
    const draft = registry.build({ wallet, file: registry.fileOf(card) });
    const reverted = world.landReverted(draft);
    await expect(registry.landed({ wallet, txHash: reverted }, live)).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
    const txHash = world.land(draft);
    world.move(0n, "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359");
    await expect(registry.landed({ wallet, txHash }, live)).resolves.toMatchObject({
      ok: true,
      value: { onchainId: "0", owner: other },
    });
  });

  it("counts no mint of a reverted simulation or another wallet's", () => {
    const { world, registry } = setup();
    const step = world.simulate(draftTo(registryAddress, "0x"));
    expect(registry.minted(step, wallet)).toBe(0);
    expect(
      registry.minted({ status: "success", gasUsed: 1n, transfers: [], approvals: [] }, wallet),
    ).toBe(0);
  });

  it("names a registry that reverts or a node that is down as faults", async () => {
    const broken = setup();
    broken.world.setVersion("2.1.0");
    await expect(broken.registry.standing(wallet, live)).resolves.toStrictEqual({
      version: "2.1.0",
      held: 0n,
    });
    broken.world.breakRegistry();
    await expect(broken.registry.standing(wallet, live)).rejects.toMatchObject({
      code: "erc8004.read_failed",
    });
    const down = setup();
    down.world.down();
    await expect(down.registry.standing(wallet, live)).rejects.toMatchObject({
      code: "chain.rpc_down",
    });
  });

  it("refuses a registry or a wallet of another chain", () => {
    const { world, registry } = setup();
    const foreign = accountRefSchema.parse(`eip155:1:${registryAddress}`);
    const elsewhere = accountRefSchema.parse("eip155:1:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
    const contracts = { "identity-registry": foreign };
    expect(codeOf(() => createErc8004Registry({ chain, rpc: world.rpc, contracts }))).toBe(
      "erc8004.bad_options",
    );
    expect(codeOf(() => createErc8004Registry({ chain, rpc: world.rpc, contracts: {} }))).toBe(
      "erc8004.bad_options",
    );
    expect(codeOf(() => registry.fileOf({ ...card, wallet: elsewhere }))).toBe(
      "erc8004.bad_request",
    );
    expect(codeOf(() => registry.build({ wallet: elsewhere, file: "data:," }))).toBe(
      "erc8004.bad_request",
    );
  });

  it("declares register(string) on the registry alone, with no spender and no approval", () => {
    expect(erc8004Declaration([chain])).toStrictEqual({
      id: "erc8004",
      contracts: [
        {
          chain,
          names: ["identity-registry"],
          calls: [
            {
              contract: "identity-registry",
              abi: {
                type: "function",
                name: "register",
                inputs: [{ name: "agentURI", type: "string" }],
                outputs: [],
                stateMutability: "nonpayable",
              },
              walletInputs: [],
            },
          ],
          unapproved: ["identity-registry"],
        },
      ],
    });
  });
});
