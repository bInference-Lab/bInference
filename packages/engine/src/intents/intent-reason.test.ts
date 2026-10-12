import { messageLocales, messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import {
  checkReasons,
  failureReasons,
  intentReasons,
  orderSkipReasons,
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
      "nothing_to_sell",
    ]);
    expect(failureReasons).toStrictEqual([
      "reverted",
      "stuck_cancelled",
      "nonce_taken",
      "step_unsent",
      "stuck_dropped",
    ]);
  });

  it("holds every reason code once in the closed list", () => {
    const all = [...policyReasons, ...riskReasons, ...checkReasons, ...failureReasons];
    expect(new Set(intentReasons)).toStrictEqual(new Set(all));
    expect(intentReasons).toHaveLength(34);
  });

  it("keeps an order's skip reasons apart from the reasons an intent stores", () => {
    expect(orderSkipReasons).toStrictEqual(["copy_daily_cap"]);
    expect(intentReasons.filter((code) => new Set<string>(orderSkipReasons).has(code))).toEqual([]);
  });

  it("has a reason message in English and Chinese for every intent and skip reason", () => {
    const wanted = [...intentReasons, ...orderSkipReasons]
      .map((code) => `reason.${code}`)
      .toSorted();
    const found = messageLocales.map((locale) =>
      Object.keys(messages[locale])
        .filter((key) => key.startsWith("reason."))
        .toSorted(),
    );
    expect(found).toStrictEqual(messageLocales.map(() => wanted));
  });
});
