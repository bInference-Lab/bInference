import { bsc, bscCeilingCaps } from "@binference/chains";
import { createScriptedHttp } from "@binference/core/testing";
import { buildCeiling, type CeilingChainPlan } from "@binference/custody-privy";
import { testCaps } from "@binference/custody-privy/testing";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { agentDefaultsSchema } from "../config/schema/defaults.schema.js";
import {
  capPlanOf,
  ceilingRequestOf,
  coreVenues,
  enabledVenues,
  initialDayCapUsd,
} from "./ceiling-request.js";

const http = createScriptedHttp([]);
const okxKeys = {
  apiKey: { fromKeychain: "okx-api-key" },
  secret: { fromKeychain: "okx-secret" },
  passphrase: { fromKeychain: "okx-passphrase" },
};

// The calls a staking venue's declaration names, each ABI with the cap of its own it carries.
function stakingCalls(id: string): readonly (readonly [unknown, bigint | undefined])[] {
  const venue = coreVenues(http, { keys: {}, kyberClientId: "binference" }).find(
    (item) => item.id === id,
  );
  const calls = venue?.contracts.flatMap((item) => item.calls ?? []) ?? [];
  return calls.map((call) => [call.abi, call.maxValueBase]);
}

describe("core venues", () => {
  it("installs KyberSwap, the Flap launchpad, StakeHub, Lista and Across while no OKX key is set, and no Relay or identity registry", () => {
    const venues = coreVenues(http, { keys: {}, kyberClientId: "binference" });
    expect(venues.map((venue) => venue.id)).toStrictEqual([
      "kyberswap",
      "flap",
      "stakehub",
      "lista",
      "across",
    ]);
  });

  it("installs StakeHub and Lista with a stake that carries up to 100 BNB in a rule of its own", () => {
    expect(stakingCalls("stakehub")).toMatchObject([
      [{ name: "delegate" }, 100n * 10n ** 18n],
      [{ name: "undelegate" }, undefined],
      [{ name: "claim" }, undefined],
    ]);
    expect(stakingCalls("lista")).toMatchObject([
      [{ name: "deposit" }, 100n * 10n ** 18n],
      [{ name: "requestWithdraw" }, undefined],
      [{ name: "claimWithdrawByUUID" }, undefined],
    ]);
  });

  it("installs Flap with the Portal's swap and create calls and the Portal as spender", () => {
    const [, flap] = coreVenues(http, { keys: {}, kyberClientId: "binference" });
    expect(flap?.contracts).toMatchObject([
      {
        chain: "eip155:56",
        names: ["portal"],
        calls: [
          { contract: "portal", abi: { name: "swapExactInput" }, walletInputs: [] },
          { contract: "portal", abi: { name: "newTokenV6" }, walletInputs: [] },
        ],
        spenders: ["portal"],
      },
    ]);
  });

  it("installs OKX with its router and TokenApprove once the owner sets its key", () => {
    const venues = coreVenues(http, { keys: { okx: okxKeys }, kyberClientId: "binference" });
    const declared = venues.map((venue) =>
      venue.contracts.map((item) => [venue.id, item.chain, item.names, item.spenders]),
    );
    expect(declared).toStrictEqual([
      [
        [
          "kyberswap",
          "eip155:56",
          ["meta-aggregation-router-v2", "aggregation-executor-proxy"],
          ["meta-aggregation-router-v2"],
        ],
      ],
      [["flap", "eip155:56", ["portal"], ["portal"]]],
      [["stakehub", "eip155:56", ["stake-hub"], undefined]],
      [["lista", "eip155:56", ["stake-manager"], ["stake-manager"]]],
      [["across", "eip155:56", ["spoke-pool"], ["spoke-pool"]]],
      [["okx", "eip155:56", ["dex-router", "token-approve"], ["token-approve"]]],
    ]);
  });
});

const bnb = 10n ** 18n;
const rescue = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
// Across's SpokePool on BSC, as the registry lists it.
const spokePool = "0x4e8E101924eDE233C13e2D8622DC8aED2872d505";

// The venues and the first wallet's ceiling init plans for a new agent on the default config.
function newAgent() {
  const config = configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
  });
  const venues = enabledVenues(config, coreVenues(http, config.venues));
  if (!venues.ok) {
    throw new Error("Expected init to enable the core venues.");
  }
  const request = ceilingRequestOf(selfHostedChains(), config, { venues: venues.value, rescue });
  const [chain] = request.ok ? request.value.chains : [];
  if (chain === undefined) {
    throw new Error("Expected init to plan the first wallet's ceiling on BSC.");
  }
  return { venues: venues.value.map((venue) => venue.id), chain, bridges: chain.bridges ?? [] };
}

// The install's caps with each capped token BSC's data names, as init makes them.
const caps = {
  ...testCaps,
  approvals: bscCeilingCaps.tokens.map((item, index) => ({
    aggregation: `testcaproute${String(index).padStart(13, "0")}`,
    limitBase: 1_000n,
    token: bsc.tokens.find((token) => token.symbol === item.symbol)?.address ?? "",
  })),
};

// The rule names of the first wallet's ceiling, written with no address saved, as init writes it.
function ruleNamesOf(chain: CeilingChainPlan): readonly string[] {
  const built = buildCeiling({ chains: [{ ...chain, caps }], rescue, saved: [] });
  return built.ok ? built.value.rules.map((rule) => rule.name) : [built.error];
}

describe("a new agent", () => {
  it("may use Across, and not Relay before it has a bridge wallet", () => {
    const { venues } = newAgent();

    expect(venues).toContain("across");
    expect(venues).not.toContain("relay");
  });

  it("gets Across's deposit to each EVM chain its routes reach in its main wallet's ceiling", () => {
    const { chain, bridges } = newAgent();

    const deposits = bridges.map((item) => [item.call.abi.name, item.destinationChainId]);
    expect(deposits).toStrictEqual([
      ["depositV3", "1"],
      ["depositV3", "8453"],
      ["depositV3", "42161"],
      ["depositV3", "4663"],
    ]);
    expect(chain.spenders).toContain(spokePool);
  });

  it("pays no bridge until an address is saved on the destination", () => {
    const names = ruleNamesOf(newAgent().chain);

    expect(names.filter((name) => name.startsWith("Bridge"))).toStrictEqual([]);
    expect(names).toContain("Approvals, chain 56");
  });
});

function tokenOf(symbol: string): string | undefined {
  return bsc.tokens.find((token) => token.symbol === symbol)?.address;
}

describe("the 24-hour caps of a ceiling", () => {
  it("are twice the default day, BNB and WBNB at $100, USDT and USDC at $1, ETH at $1,000", () => {
    const plan = capPlanOf(bsc, initialDayCapUsd({ defaults: agentDefaultsSchema.parse({}) }));
    expect(plan.nativeLimitBase).toBe(10n * bnb);
    expect(plan.approvals).toStrictEqual([
      { token: tokenOf("WBNB"), limitBase: 10n * bnb },
      { token: tokenOf("USDT"), limitBase: 1_000n * bnb },
      { token: tokenOf("USDC"), limitBase: 1_000n * bnb },
      { token: tokenOf("ETH"), limitBase: bnb },
    ]);
  });

  it("follow the agent-wide day the config sets, rounded up to a whole base unit", () => {
    const defaults = agentDefaultsSchema.parse({ limits: { rollingDayUsd: "0.000001" } });
    const plan = capPlanOf(bsc, initialDayCapUsd({ defaults }));
    expect(plan.nativeLimitBase).toBe(20_000_000_000n);
    expect(plan.approvals.map((item) => item.limitBase)).toStrictEqual([
      20_000_000_000n,
      2_000_000_000_000n,
      2_000_000_000_000n,
      2_000_000_000n,
    ]);
  });
});
