import { messageLocales, messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { downtimeReasons } from "../downtime/downtime-check.js";
import {
  checkReasons,
  failureReasons,
  fillReasons,
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
      "snipe_tax",
      "high_tax",
      "high_pool_fee",
      "high_tax_with_pool_fee",
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
      "balance_unread",
      "needs_launch_wallet",
      "launch_unread",
      "launch_moved",
      "image_unreadable",
      "pin_failed",
      "pin_timeout",
      "upload_lost",
      "ceiling_lacks_call",
    ]);
    expect(failureReasons).toStrictEqual([
      "reverted",
      "stuck_cancelled",
      "nonce_taken",
      "step_unsent",
      "stuck_dropped",
    ]);
    expect(fillReasons).toStrictEqual([
      "order_inactive",
      "fill_bounds",
      "worst_price",
      "trigger_unconfirmed",
      "live_fills_off",
      "price_stale",
    ]);
  });

  it("holds every reason code once in the closed list", () => {
    const all = [
      ...policyReasons,
      ...riskReasons,
      ...checkReasons,
      ...failureReasons,
      ...fillReasons,
    ];
    expect(new Set(intentReasons)).toStrictEqual(new Set(all));
    expect(intentReasons).toHaveLength(52);
  });

  it("keeps an order's skip reasons apart from the reasons an intent stores", () => {
    expect(orderSkipReasons).toStrictEqual([
      "copy_daily_cap",
      "engine_locked",
      "nothing_to_spend",
      "fill_failed",
      "fill_lapsed",
      "owner_cancelled",
      "missed",
      "late",
      "fill_waiting",
      "period_unreadable",
      "share_unread",
      "token_unreadable",
      "leader_unpriced",
      "copy_sale_lapsed",
      "copy_too_small",
      "copy_hourly",
    ]);
    expect(intentReasons.filter((code) => new Set<string>(orderSkipReasons).has(code))).toEqual([]);
  });

  it("has a reason message in English and Chinese for every intent, skip and re-check reason", () => {
    const wanted = [...intentReasons, ...orderSkipReasons, ...downtimeReasons]
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
