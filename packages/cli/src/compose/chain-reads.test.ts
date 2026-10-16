import { chainRefSchema, createChainRegistry } from "@binference/chain";
import { createEvmFamily, createEvmSigningScheme } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import { BinferenceError, type Http } from "@binference/core";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ChainsConfig } from "../config/schema/chains-venues.schema.js";
import { chainReadsOf, composeChainReads, rpcEndpointsOf, rpcHealthOf } from "./chain-reads.js";
import { selfHostedChains } from "./open-engine-parts.js";

const bscRef = chainRefSchema.parse(bsc.id);
const config: ChainsConfig = {
  enabled: [bscRef],
  rpc: { [bscRef]: { urls: ["https://node.example.org"] } },
  relays: {},
  maxFeePerGasGwei: { [bscRef]: "1" },
};
const signal = new AbortController().signal;

// An Http on which the hosts `isDown` names reach nothing, and every other node answers chain 56.
function nodes(isDown: (url: string) => boolean): Http {
  return {
    request: async (request) =>
      isDown(request.url)
        ? Promise.reject(
            new BinferenceError({ code: "http.unreachable", message: "Down.", retryable: true }),
          )
        : Promise.resolve({
            status: 200,
            headers: {},
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x38" }),
          }),
  };
}

// An Http that notes each host asked: `down` reaches nothing, every other node echoes the
// request's id with chain 56.
function echoingNodes(asked: string[], down: string): Http {
  const refused = new BinferenceError({
    code: "http.unreachable",
    message: "Down.",
    retryable: true,
  });
  return {
    request: async (request) => {
      const { host } = new URL(request.url);
      asked.push(host);
      const { id } = z.object({ id: z.number() }).parse(JSON.parse(request.body ?? "{}"));
      const body = JSON.stringify({ jsonrpc: "2.0", id, result: "0x38" });
      return host === down
        ? Promise.reject(refused)
        : Promise.resolve({ status: 200, headers: {}, body });
    },
  };
}

describe("the chains' reads", () => {
  it("asks config's RPCs before the chain's public ones", () => {
    const endpoints = rpcEndpointsOf(bsc, { urls: ["https://node.example.org"] });
    expect(endpoints.map(({ name }) => name)).toStrictEqual([
      "config-1",
      "bnbchain-dataseed",
      "bnbchain-dataseed-public",
    ]);
    expect(rpcEndpointsOf(bsc, undefined)).toHaveLength(2);
  });

  it("reads each enabled chain with its fee cap and the registry's Multicall3", () => {
    const clock = createManualClock();
    const http = createScriptedHttp([]);
    const reads = composeChainReads({ chains: selfHostedChains(), config, http, clock });
    const bscReads = chainReadsOf(reads, bscRef);
    expect([
      bscReads.networkFeeCapWeiPerGas,
      bscReads.multicall,
      bscReads.evm.chainId,
    ]).toStrictEqual([1_000_000_000n, "0xcA11bde05977b3631167028862bE2a173976CA11", 56]);
    const disabled = { ...config, enabled: [] };
    const none = composeChainReads({ chains: selfHostedChains(), config: disabled, http, clock });
    expect(none.size).toBe(0);
    expect(() => chainReadsOf(none, bscRef)).toThrow(
      expect.objectContaining({ code: "cli.no_chain_parts" }),
    );
  });

  it("refuses a chain with no fee cap, or whose registry lists no Multicall3", () => {
    const options = { http: createScriptedHttp([]), clock: createManualClock() };
    expect(() =>
      composeChainReads({
        ...options,
        chains: selfHostedChains(),
        config: { ...config, maxFeePerGasGwei: {} },
      }),
    ).toThrow(expect.objectContaining({ code: "cli.no_fee_cap" }));
    const bare = createChainRegistry({
      chains: [{ ...bsc, contracts: bsc.contracts.filter(({ venue }) => venue !== "multicall3") }],
      families: [createEvmFamily()],
      signingSchemes: [createEvmSigningScheme()],
    });
    expect(() => composeChainReads({ ...options, chains: bare, config })).toThrow(
      expect.objectContaining({ code: "cli.no_multicall" }),
    );
  });

  it.each([
    ["a warning while some endpoints rest", (url: string) => url.includes("example"), "warn"],
    ["failed while every endpoint rests", () => true, "fail"],
  ] as const)("reads the rpc signal as %s", async (_case, isDown, state) => {
    const clock = createManualClock();
    const http = nodes(isDown);
    const reads = composeChainReads({ chains: selfHostedChains(), config, http, clock });
    const { rpc } = chainReadsOf(reads, bscRef);
    expect(rpcHealthOf(reads, clock)).toBe("ok");
    const call = { method: "eth_chainId", params: [], result: z.string(), signal };
    await rpc.request(call).catch(() => undefined);
    expect(rpcHealthOf(reads, clock)).toBe(state);
    await clock.advance(30_001);
    expect(rpcHealthOf(reads, clock)).toBe("ok");
    expect(rpcHealthOf(new Map(), clock)).toBe("ok");
  });

  it("asks the RPCs config names at each request, and keeps their health while they stay", async () => {
    const clock = createManualClock();
    const asked: string[] = [];
    const http = echoingNodes(asked, "down.example.net");
    const held = { chains: config };
    const current = () => held.chains;
    const reads = composeChainReads({ chains: selfHostedChains(), config, current, http, clock });
    const { rpc } = chainReadsOf(reads, bscRef);
    const call = { method: "eth_chainId", params: [], result: z.string(), signal };
    await rpc.request(call);
    held.chains = { ...config, rpc: { [bscRef]: { urls: ["https://down.example.net"] } } };
    await rpc.request(call);
    await rpc.request(call);
    expect(asked.slice(0, 2)).toStrictEqual(["node.example.org", "down.example.net"]);
    expect(asked.at(-1)).not.toBe("down.example.net");
    expect(rpc.health().map(({ name }) => name)[0]).toBe("config-1");
  });
});
