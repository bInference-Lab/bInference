import { accountRefSchema, chainRefSchema } from "@binference/chain";
import { createFakeNonceSource, nonceSourceContract } from "@binference/chain/testing";
import { bsc } from "@binference/chains";
import {
  createManualClock,
  createMemoryLogger,
  createScriptedHttp,
  createSeededRandom,
} from "@binference/core/testing";
import {
  createFakePriceSource,
  createFakeWalletFacts,
  createMemoryEngineStores,
  createMemoryPositionStore,
} from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import type { ChainsConfig } from "../config/schema/chains-venues.schema.js";
import { composeChainReads } from "./chain-reads.js";
import { composeExecutor, nonceRouterOf, relayEndpointsOf } from "./compose-executor.js";
import { createCustodyCell } from "./custody-cell.js";
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
  const http = createScriptedHttp([]);
  const clock = createManualClock();
  return composeExecutor({
    stores: createMemoryEngineStores(),
    positions: createMemoryPositionStore(),
    custody: createCustodyCell().signer,
    wallets: createFakeWalletFacts(new Map(), {
      nativeBalanceBase: 0n,
      ceilingPerTxNativeBase: 0n,
      feePerGasNativeBase: 0n,
      networkFeeCapNativeBase: 0n,
      recentOutflows: [],
    }),
    prices: createFakePriceSource(new Map()),
    chains,
    venues: [],
    reads: composeChainReads({ chains, config: chainsConfig, http, clock }),
    relays: chainsConfig.relays,
    http,
    clock,
    random: createSeededRandom(1),
    publish: () => undefined,
    logger: createMemoryLogger({ subsystem: "engine" }),
  });
}

describe("the self-hosted executor", () => {
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

  it("builds the executor with a healthy signal, and refuses a chain with no fee cap", async () => {
    const composed = composeWith(config);
    expect(composed.health()).toBe("ok");
    await composed.executor.close({ signal: new AbortController().signal });
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
