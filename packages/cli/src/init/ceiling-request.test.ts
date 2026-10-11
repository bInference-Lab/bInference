import { bsc } from "@binference/chains";
import { createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { agentDefaultsSchema } from "../config/schema/defaults.schema.js";
import { capPlanOf, coreVenues } from "./ceiling-request.js";

const http = createScriptedHttp([]);
const okxKeys = {
  apiKey: { fromKeychain: "okx-api-key" },
  secret: { fromKeychain: "okx-secret" },
  passphrase: { fromKeychain: "okx-passphrase" },
};

describe("core venues", () => {
  it("installs KyberSwap alone while no OKX key is set", () => {
    const venues = coreVenues(http, { keys: {}, kyberClientId: "binference" });
    expect(venues.map((venue) => venue.id)).toStrictEqual(["kyberswap"]);
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
      [["okx", "eip155:56", ["dex-router", "token-approve"], ["token-approve"]]],
    ]);
  });
});

const bnb = 10n ** 18n;

function tokenOf(symbol: string): string | undefined {
  return bsc.tokens.find((token) => token.symbol === symbol)?.address;
}

describe("the 24-hour caps of a ceiling", () => {
  it("are twice the default day, BNB and WBNB at $100, USDT and USDC at $1", () => {
    const plan = capPlanOf(bsc, { defaults: agentDefaultsSchema.parse({}) });
    expect(plan.nativeLimitBase).toBe(10n * bnb);
    expect(plan.approvals).toStrictEqual([
      { token: tokenOf("WBNB"), limitBase: 10n * bnb },
      { token: tokenOf("USDT"), limitBase: 1_000n * bnb },
      { token: tokenOf("USDC"), limitBase: 1_000n * bnb },
    ]);
  });

  it("follow the agent-wide day the config sets, rounded up to a whole base unit", () => {
    const defaults = agentDefaultsSchema.parse({ limits: { rollingDayUsd: "0.000001" } });
    const plan = capPlanOf(bsc, { defaults });
    expect(plan.nativeLimitBase).toBe(20_000_000_000n);
    expect(plan.approvals.map((item) => item.limitBase)).toStrictEqual([
      20_000_000_000n,
      2_000_000_000_000n,
      2_000_000_000_000n,
    ]);
  });
});
