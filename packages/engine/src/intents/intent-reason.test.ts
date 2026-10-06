import { messageLocales, messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import {
  checkReasons,
  failureReasons,
  intentReasons,
  policyReasons,
  riskReasons,
} from "./intent-reason.js";

describe("intent reasons", () => {
  it("lists the policy reasons of spec 6, section 4", () => {
    expect(policyReasons).toStrictEqual([
      "frozen",
      "paper_only",
      "per_trade_cap",
      "ceiling",
      "daily_cap",
      "gas_reserve",
      "slippage",
      "price_impact",
      "tax",
      "venue_off",
      "token_denied",
      "send_level",
      "unsaved_address",
      "outside_content_send",
      "health_factor",
      "no_price",
    ]);
  });

  it("lists the risk, check and failure reasons", () => {
    expect(riskReasons).toStrictEqual([
      "honeypot",
      "cannot_sell",
      "hidden_owner",
      "high_tax",
      "low_liquidity",
      "sources_down",
      "blacklisted",
    ]);
    expect(checkReasons).toStrictEqual([
      "no_route",
      "venue_down",
      "decode_mismatch",
      "simulation_reverted",
      "effects_differ",
      "price_impact",
    ]);
    expect(failureReasons).toStrictEqual(["reverted", "stuck_cancelled", "nonce_taken"]);
  });

  it("holds every reason code once in the closed list", () => {
    const all = [...policyReasons, ...riskReasons, ...checkReasons, ...failureReasons];
    expect(new Set(intentReasons)).toStrictEqual(new Set(all));
    expect(intentReasons).toHaveLength(31);
  });

  it("has a reason message in English and Chinese for every reason code", () => {
    const wanted = intentReasons.map((code) => `reason.${code}`).toSorted();
    const found = messageLocales.map((locale) =>
      Object.keys(messages[locale])
        .filter((key) => key.startsWith("reason."))
        .toSorted(),
    );
    expect(found).toStrictEqual(messageLocales.map(() => wanted));
  });
});
