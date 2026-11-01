import { chainRefSchema, type TxHash } from "@binference/chain";
import { arbitrum, baseMainnet, bsc, ethereum, robinhood, solana } from "@binference/chains";
import { createSecret, type HttpRequest } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { ChainsConfig } from "../config/schema/chains-venues.schema.js";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains } from "./open-engine-parts.js";
import { selfHostedBridging } from "./self-hosted-bridging.js";

const bscRef = chainRefSchema.parse(bsc.id);
const refusing = { request: async () => Promise.reject(new Error("No network in a unit test.")) };
const clock = createManualClock();
const destinations = [ethereum, baseMainnet, arbitrum, robinhood, solana].map((item) =>
  chainRefSchema.parse(item.id),
);

function readsOn(enabled: ChainsConfig["enabled"]) {
  const config: ChainsConfig = {
    enabled,
    rpc: {},
    relays: {},
    maxFeePerGasGwei: { [bscRef]: "1" },
  };
  return composeChainReads({ chains: selfHostedChains(), config, http: refusing, clock });
}

// Asks the hosted Relay bridge where an unseen deposit stands.
async function relayStatus(bridging: ReturnType<typeof selfHostedBridging>) {
  const relay = bridging.engine.bridges.find(({ bridge }) => bridge.id === "relay");
  const deposit = { chain: bscRef, hash: `0x${"11".repeat(32)}` as TxHash };
  return relay?.bridge.status(deposit, { signal: new AbortController().signal });
}

describe("this binference's bridging parts", () => {
  it("runs Across and Relay from BNB Smart Chain, and reads code and deliveries on each chain it touches", () => {
    const bridging = selfHostedBridging({ http: refusing, clock, reads: readsOn([bscRef]) });

    expect(bridging.engine.bridges.map(({ bridge }) => bridge.id)).toStrictEqual([
      "across",
      "relay",
    ]);
    expect(bridging.engine.bridges.map(({ routes }) => routes.length)).toStrictEqual([10, 10]);
    expect(bridging.engine.codeReaders.map((reader) => reader.chain)).toStrictEqual([bscRef]);
    expect(bridging.engine.deliveryReaders.map((reader) => reader.chain)).toStrictEqual([
      bscRef,
      ...destinations,
    ]);
    expect(bridging.engine.destinations.map((item) => item.ref)).toStrictEqual(destinations);
    expect(bridging.executor.bridges.map((bridge) => bridge.id)).toStrictEqual(["across", "relay"]);
    expect(bridging.executor.destinations).toBe(bridging.engine.destinations);
  });

  it("sends the owner's Relay key with each Relay request, and none without one", async () => {
    const asked: HttpRequest[] = [];
    const recording = {
      request: async (request: HttpRequest) => {
        asked.push(request);
        return Promise.reject(new Error("No network in a unit test."));
      },
    };
    const reads = readsOn([bscRef]);
    const keyed = selfHostedBridging({
      http: recording,
      clock,
      reads,
      relayKey: createSecret("relay-key"),
    });
    const keyless = selfHostedBridging({ http: recording, clock, reads });
    await expect(relayStatus(keyed)).rejects.toThrow("No network in a unit test.");
    await expect(relayStatus(keyless)).rejects.toThrow("No network in a unit test.");
    expect(asked.map((request) => request.headers)).toStrictEqual([
      { "x-api-key": "relay-key" },
      {},
    ]);
  });

  it("runs no bridge while BNB Smart Chain is off, and still reads the destinations", () => {
    const bridging = selfHostedBridging({ http: refusing, clock, reads: readsOn([]) });

    expect(bridging.engine.bridges).toStrictEqual([]);
    expect(bridging.engine.codeReaders).toStrictEqual([]);
    expect(bridging.engine.deliveryReaders.map((reader) => reader.chain)).toStrictEqual(
      destinations,
    );
  });
});
