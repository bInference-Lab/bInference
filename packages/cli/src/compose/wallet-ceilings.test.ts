import { createFakeBridgeVenue, createFakeVenue } from "@binference/chain/testing";
import { bscVenueCalls } from "@binference/chains";
import { createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { coreVenues } from "../init/ceiling-request.js";
import { selfHostedChains } from "./open-engine-parts.js";
import { ceilingChainsOf, ceilingVenuesOf } from "./wallet-ceilings.js";

const installed = [createFakeVenue(), createFakeBridgeVenue()];
const ids = (role?: "launch" | "bridge", venues: readonly string[] = ["fake-swap"]) =>
  ceilingVenuesOf(installed, { venues, role }).map((venue) => venue.id);

// Relay as its plugin will declare it, from the registry's calls on BNB Smart Chain.
const relay = { id: "relay", contracts: [bscVenueCalls["relay"]].flatMap((item) => item ?? []) };
const config = configSchema.parse({
  version: currentConfigVersion,
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
});
const venues = [...coreVenues(createScriptedHttp([]), config.venues), relay];
const plans = { chains: selfHostedChains(), config, venues };

describe("the venues a wallet's ceiling is planned from", () => {
  it("gives a bridge wallet every bridge venue the install runs, whichever the agent uses", () => {
    expect(ids("bridge")).toStrictEqual(["fake-bridge"]);
    expect(ids("bridge", [])).toStrictEqual(["fake-bridge"]);
  });

  it("gives any other wallet the venues named", () => {
    expect([ids(), ids("launch")]).toStrictEqual([["fake-swap"], ["fake-swap"]]);
  });
});

describe("a bridge wallet's ceiling as the CLI plans it", () => {
  it("holds Relay's deposits and its depository though the agent uses only KyberSwap", () => {
    const [chain] = ceilingChainsOf(plans, { venues: ["kyberswap"], role: "bridge" }).chains;

    expect(chain?.calls.map((call) => [call.abi.name, call.walletInputs])).toStrictEqual([
      ["depositErc20", ["depositor"]],
      ["depositNative", ["depositor"]],
    ]);
    expect(chain?.spenders).toStrictEqual(["0x4cD00E387622C35bDDB9b4c962C136462338BC31"]);
  });

  it("holds no Relay call in a main wallet's ceiling though the agent names Relay", () => {
    const [chain] = ceilingChainsOf(plans, { venues: ["kyberswap", "relay"] }).chains;

    expect(chain?.calls.map((call) => call.abi.name)).not.toContain("depositErc20");
    expect(chain?.spenders).not.toContain("0x4cD00E387622C35bDDB9b4c962C136462338BC31");
  });
});
