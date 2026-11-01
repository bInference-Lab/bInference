import { chainRefSchema } from "@binference/chain";
import { arbitrum, baseMainnet, bsc, ethereum, robinhood, solana } from "@binference/chains";
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

describe("this binference's bridging parts", () => {
  it("runs Across from BNB Smart Chain, and reads code and deliveries on each chain it touches", () => {
    const bridging = selfHostedBridging({ http: refusing, clock, reads: readsOn([bscRef]) });

    expect(bridging.engine.bridges.map(({ bridge }) => bridge.id)).toStrictEqual(["across"]);
    expect(bridging.engine.bridges[0]?.routes).toHaveLength(10);
    expect(bridging.engine.codeReaders.map((reader) => reader.chain)).toStrictEqual([bscRef]);
    expect(bridging.engine.deliveryReaders.map((reader) => reader.chain)).toStrictEqual([
      bscRef,
      ...destinations,
    ]);
    expect(bridging.engine.destinations.map((item) => item.ref)).toStrictEqual(destinations);
    expect(bridging.executor.bridges.map((bridge) => bridge.id)).toStrictEqual(["across"]);
    expect(bridging.executor.destinations).toBe(bridging.engine.destinations);
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
