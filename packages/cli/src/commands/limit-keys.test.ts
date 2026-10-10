import { describe, expect, it } from "vitest";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { limitChangesOf } from "./limit-keys.js";

const chains = selfHostedChains();

describe("limitChangesOf", () => {
  it("reads each limit in the units of the config file", () => {
    const sets = [
      "limits.perTradeUsd=50.5",
      "limits.slippageBps.other=300",
      "limits.minHealthFactor=1.8",
      "cards.tradeExpirySec=30",
      "orders.expiryDays=7",
      "limits.venues=kyberswap, okx",
      "limits.allowTokens=",
      "limits.gasReserve.eip155:56=0.003",
    ];

    expect(limitChangesOf(chains, sets)).toStrictEqual({
      ok: true,
      value: {
        perTradeUsdMicros: 50_500_000n,
        slippageOtherBps: 300,
        minHealthFactorBps: 18_000,
        cardTradeExpirySeconds: 30,
        orderExpiryDays: 7,
        venues: ["kyberswap", "okx"],
        allowTokens: [],
        gasReserve: { "eip155:56": 3_000_000_000_000_000n },
      },
    });
  });

  it("takes the later of two sets of one limit", () => {
    const sets = ["copy.perBuyUsd=10", "copy.perBuyUsd=12"];

    expect(limitChangesOf(chains, sets)).toStrictEqual({
      ok: true,
      value: { copyPerBuyUsdMicros: 12_000_000n },
    });
  });

  it.each([
    ["limits.perTradeUsd", { kind: "bad_set", set: "limits.perTradeUsd" }],
    ["owner.locale=zh", { kind: "bad_set", set: "owner.locale=zh" }],
    ["=5", { kind: "bad_set", set: "=5" }],
    ["limits.perTradeUsd=lots", { kind: "bad_value", key: "limits.perTradeUsd", value: "lots" }],
    [
      "limits.perTradeUsd=0.0000001",
      { kind: "bad_value", key: "limits.perTradeUsd", value: "0.0000001" },
    ],
    ["limits.taxBps=20000", { kind: "bad_value", key: "limits.taxBps", value: "20000" }],
    [
      "limits.minHealthFactor=0.5",
      { kind: "bad_value", key: "limits.minHealthFactor", value: "0.5" },
    ],
    ["cards.tradeExpirySec=0", { kind: "bad_value", key: "cards.tradeExpirySec", value: "0" }],
    ["limits.denyTokens=TKN", { kind: "bad_value", key: "limits.denyTokens", value: "TKN" }],
    [
      "limits.gasReserve.eip155:999=1",
      { kind: "bad_value", key: "limits.gasReserve.eip155:999", value: "1" },
    ],
  ])("refuses %s, naming why", (set, problem) => {
    expect(limitChangesOf(chains, [set])).toStrictEqual({ ok: false, problem });
  });
});
