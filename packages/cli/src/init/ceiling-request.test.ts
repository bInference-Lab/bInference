import { bsc } from "@binference/chains";
import { createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { agentDefaultsSchema } from "../config/schema/defaults.schema.js";
import { capPlanOf, coreVenues, initialDayCapUsd } from "./ceiling-request.js";

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
  it("installs KyberSwap, the Flap launchpad, StakeHub and Lista while no OKX key is set, and no identity registry", () => {
    const venues = coreVenues(http, { keys: {}, kyberClientId: "binference" });
    expect(venues.map((venue) => venue.id)).toStrictEqual([
      "kyberswap",
      "flap",
      "stakehub",
      "lista",
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
      [["okx", "eip155:56", ["dex-router", "token-approve"], ["token-approve"]]],
    ]);
  });
});

const bnb = 10n ** 18n;

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
