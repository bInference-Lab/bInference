import { chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { coreVenues } from "../init/ceiling-request.js";
import { selfHostedCeilingVenues } from "./ceiling-venues.js";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains } from "./open-engine-parts.js";
import { selfHostedBridging } from "./self-hosted-bridging.js";
import { ceilingCallsOn, ceilingChainsOf } from "./wallet-ceilings.js";

const bscRef = chainRefSchema.parse(bsc.id);
const bnb = 10n ** 18n;
const config = configSchema.parse({
  version: currentConfigVersion,
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
});

// The venues a running engine plans ceilings from, over BSC reads of a node the test never asks:
// KyberSwap and Flap stand for the venues it quotes on, as `readVenues` gives them.
function runningVenues() {
  const http = createScriptedHttp([]);
  const clock = createManualClock(0);
  const reads = composeChainReads({
    chains: selfHostedChains(),
    config: {
      enabled: [bscRef],
      rpc: { [bscRef]: { urls: ["https://node.example.org/"] } },
      relays: {},
      maxFeePerGasGwei: { [bscRef]: "1" },
    },
    http,
    clock,
  });
  const quoting = coreVenues(http, config.venues).filter(({ id }) =>
    ["kyberswap", "flap"].includes(id),
  );
  const { bridges } = selfHostedBridging({ http, clock, reads }).executor;
  return { venues: selfHostedCeilingVenues({ venues: quoting, reads, bridges }), http };
}

const names = (calls: readonly { readonly abi: { readonly name: string } }[]) =>
  calls.map((call) => call.abi.name);

// The value of a plan the install could make.
function planned<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("Expected the install to plan it.");
  }
  return result.value;
}

describe("the venues a running engine plans ceilings from", () => {
  it("runs the staking venues and the bridges beside the venues it quotes on, each once", () => {
    const { venues, http } = runningVenues();

    expect(venues.map(({ id }) => id)).toStrictEqual([
      "kyberswap",
      "flap",
      "stakehub",
      "lista",
      "across",
      "relay",
    ]);
    expect(http.requests()).toStrictEqual([]);
  });

  it("keeps StakeHub's and Lista's calls, the stake's own cap and Across's deposits in a rewrite", () => {
    const plans = { chains: selfHostedChains(), venues: runningVenues().venues };
    const named = ["kyberswap", "stakehub", "lista", "across"];

    const plan = planned(ceilingCallsOn(plans, bscRef, { venues: named, perTxNativeBase: bnb }));

    expect(names(plan.calls)).toStrictEqual(
      expect.arrayContaining([
        "delegate",
        "undelegate",
        "claim",
        "deposit",
        "requestWithdraw",
        "claimWithdrawByUUID",
      ]),
    );
    expect(plan.calls.find((call) => call.abi.name === "delegate")?.maxValueBase).toBe(100n * bnb);
    expect(plan.bridges?.length).toBeGreaterThan(0);
  });

  it("gives a new wallet StakeHub's and Lista's calls when its agent names them", () => {
    const plans = { chains: selfHostedChains(), config, venues: runningVenues().venues };

    const drafted = planned(ceilingChainsOf(plans, { venues: ["kyberswap", "stakehub", "lista"] }));

    const [chain] = drafted.chains.map((item) => names(item.calls));
    expect(chain).toStrictEqual(
      expect.arrayContaining(["delegate", "undelegate", "claim", "deposit"]),
    );
  });

  it("refuses a change that names a venue the install does not run", () => {
    const plans = { chains: selfHostedChains(), venues: runningVenues().venues };

    const plan = ceilingCallsOn(plans, bscRef, {
      venues: ["kyberswap", "pancakeswap"],
      perTxNativeBase: bnb,
    });

    expect(plan).toStrictEqual({ ok: false, error: "venue_not_run" });
  });
});
