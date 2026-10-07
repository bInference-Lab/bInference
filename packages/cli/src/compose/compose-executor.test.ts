import { accountRefSchema, chainRefSchema } from "@binference/chain";
import { createFakeNonceSource, nonceSourceContract } from "@binference/chain/testing";
import { bsc } from "@binference/chains";
import {
  createManualClock,
  createMemoryLogger,
  createScriptedHttp,
  createSeededRandom,
} from "@binference/core/testing";
import { createMemoryEngineStores } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import type { ChainsConfig } from "../config/schema/chains-venues.schema.js";
import {
  composeExecutor,
  gweiToWei,
  nonceRouterOf,
  relayEndpointsOf,
  rpcEndpointsOf,
} from "./compose-executor.js";
import { createMissingParts } from "./missing-parts.js";
import { selfHostedChains } from "./open-engine-parts.js";

const chains = selfHostedChains();
const bscRef = chainRefSchema.parse(bsc.id);
const bscChain = registered();

function registered() {
  const chain = chains.get(bscRef);
  if (!chain.ok) {
    throw new Error("Expected BSC in the self-hosted registry.");
  }
  return chain.value;
}
const config: ChainsConfig = {
  enabled: [bscRef],
  rpc: {},
  relays: {},
  maxFeePerGasGwei: { [bscRef]: "1" },
};

function composeWith(chainsConfig: ChainsConfig) {
  const parts = createMissingParts();
  return composeExecutor({
    stores: createMemoryEngineStores(),
    custody: parts.custody,
    wallets: parts.wallets,
    prices: parts.prices,
    chains,
    config: chainsConfig,
    http: createScriptedHttp([]),
    clock: createManualClock(),
    random: createSeededRandom(1),
    publish: () => undefined,
    logger: createMemoryLogger({ subsystem: "engine" }),
  });
}

describe("the self-hosted executor", () => {
  it.each([
    ["1", 1_000_000_000n],
    ["0.05", 50_000_000n],
    ["2.5", 2_500_000_000n],
    ["0.000000001", 1n],
  ])("reads a fee cap of %s gwei as %d wei", (gwei, wei) => {
    expect(gweiToWei(gwei, bscRef)).toBe(wei);
  });

  it.each(["0.0000000001", "1e9", "-1", ""])("refuses %j as a fee cap in gwei", (gwei) => {
    expect(() => gweiToWei(gwei, bscRef)).toThrow(
      expect.objectContaining({ code: "cli.bad_fee_cap" }),
    );
  });

  it("sends to every relay the chain lists until config names some", () => {
    const chain = bscChain;
    expect(relayEndpointsOf(chain, undefined).map(({ name }) => name)).toStrictEqual([
      "club48",
      "blockrazor",
      "pancakeswap-mev-guard",
    ]);
    expect(relayEndpointsOf(chain, ["blockrazor", "https://relay.example.org/rpc"])).toStrictEqual([
      { name: "blockrazor", url: "https://bsc.blockrazor.xyz/fullprivacy" },
      { name: "relay.example.org", url: "https://relay.example.org/rpc" },
    ]);
  });

  it.each(["fastest", "http://relay.example.org"])("refuses %j as a relay", (entry) => {
    expect(() => relayEndpointsOf(bscChain, [entry])).toThrow(
      expect.objectContaining({ code: "cli.unknown_relay" }),
    );
  });

  it("asks config's RPCs before the chain's public ones", () => {
    const endpoints = rpcEndpointsOf(bsc, { urls: ["https://node.example.org"] });
    expect(endpoints.map(({ name }) => name)).toStrictEqual([
      "config-1",
      "bnbchain-dataseed",
      "bnbchain-dataseed-public",
    ]);
    expect(rpcEndpointsOf(bsc, undefined)).toHaveLength(2);
  });

  it("builds the executor with a healthy signal, and refuses a chain with no fee cap", async () => {
    const composed = composeWith(config);
    expect(composed.health()).toBe("ok");
    await composed.executor.close();
    expect(() => composeWith({ ...config, maxFeePerGasGwei: {} })).toThrow(
      expect.objectContaining({ code: "cli.no_fee_cap" }),
    );
  });

  it.each(
    nonceSourceContract({
      create: async () => {
        const known = accountRefSchema.parse(
          `${bscRef}:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`,
        );
        const unseen = accountRefSchema.parse(
          `${bscRef}:0x10ED43C718714eb63d5aA57B78B54704E256024E`,
        );
        const source = nonceRouterOf(
          new Map([[bscRef, createFakeNonceSource(new Map([[known, 7]]))]]),
        );
        return await Promise.resolve({ source, known: { account: known, next: 7 }, unseen });
      },
    }),
  )("routes each account to its chain's nonce source: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses an account of a chain it has no source for", async () => {
    const other = accountRefSchema.parse("eip155:1:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
    const signal = new AbortController().signal;
    await expect(nonceRouterOf(new Map()).next(other, { signal })).rejects.toMatchObject({
      code: "cli.no_chain_parts",
    });
  });
});
