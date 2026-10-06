import type { Bps } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { CardRules } from "./card-rules.js";
import { confirmRequote, confirmTap, expireCard, reopenCard } from "./confirmation-guards.js";
import type { CardTerms, IntentStatus, QuoteTerms } from "./intent-status.js";
import type { GuardInput } from "./transition-guard.js";

const cards: CardRules = {
  tradeExpiryMs: 60_000,
  otherExpiryMs: 600_000,
  requoteAfterMs: 10_000,
  requoteToleranceBps: 50 as Bps,
};

const bare: IntentStatus = {
  state: "awaiting_confirmation",
  kind: "swap",
  proposer: "agent_runtime",
  isPaper: false,
  hasOutsideContent: false,
  changedAtMs: 10_000,
};
const quote: QuoteTerms = { quotedAtMs: 9_000, minOutBase: 1_000_000n };
const card: CardTerms = { version: 2, openedAtMs: 10_000, expiresAtMs: 70_000 };
// Card version 2, opened at 10 s on a quote from 9 s, expiring at 70 s.
const awaiting: IntentStatus = { ...bare, quote, card };
const withoutCard: IntentStatus = { ...bare, quote };
const withoutQuote: IntentStatus = { ...bare, card };

function tap(nowMs: number, cardVersion = 2, status = awaiting): GuardInput<"confirm_tapped"> {
  return { status, trigger: { type: "confirm_tapped", cardVersion, cards }, nowMs };
}

function requoted(
  requote: QuoteTerms,
  nowMs = 30_000,
  cardVersion = 2,
): GuardInput<"confirm_requoted"> {
  return {
    status: awaiting,
    trigger: { type: "confirm_requoted", cardVersion, requote, cards },
    nowMs,
  };
}

describe("a tap on the card", () => {
  it("confirms the current version while its quote is fresh", () => {
    expect(confirmTap(tap(19_000))).toStrictEqual({ ok: true, value: {} });
  });

  it("refuses a tap on an older card version", () => {
    expect(confirmTap(tap(12_000, 1))).toStrictEqual({ ok: false, error: "card_changed" });
  });

  it("refuses a tap when the intent has no card or no quote", () => {
    const changed = { ok: false, error: "card_changed" };
    expect(confirmTap(tap(12_000, 2, withoutCard))).toStrictEqual(changed);
    expect(confirmTap(tap(12_000, 2, withoutQuote))).toStrictEqual(changed);
  });

  it("refuses a tap from the moment the card expires", () => {
    const unpriced = { ...awaiting, quote: { quotedAtMs: 9_000 } };
    expect(confirmTap(tap(69_999, 2, unpriced))).toStrictEqual({ ok: true, value: {} });
    expect(confirmTap(tap(70_000, 2, unpriced))).toStrictEqual({ ok: false, error: "expired" });
  });

  it("asks for a re-quote when the quote is older than 10 s", () => {
    expect(confirmTap(tap(19_000))).toStrictEqual({ ok: true, value: {} });
    expect(confirmTap(tap(19_001))).toStrictEqual({ ok: false, error: "quote_stale" });
  });

  it("never finds a quote without a price stale", () => {
    const unpriced = { ...awaiting, quote: { quotedAtMs: 9_000 } };
    expect(confirmTap(tap(60_000, 2, unpriced))).toStrictEqual({ ok: true, value: {} });
  });
});

describe("a tap after a re-quote", () => {
  it("confirms on the new quote when its minimum out is within the tolerance", () => {
    const requote = { quotedAtMs: 29_000, minOutBase: 995_000n };
    expect(confirmRequote(requoted(requote))).toStrictEqual({
      ok: true,
      value: { quote: requote },
    });
    expect(reopenCard(requoted(requote))).toStrictEqual({ ok: false, error: "quote_held" });
  });

  it("opens the next card version when the minimum out is worse than the tolerance", () => {
    const requote = { quotedAtMs: 29_000, minOutBase: 994_999n };
    expect(confirmRequote(requoted(requote))).toStrictEqual({ ok: false, error: "quote_worse" });
    expect(reopenCard(requoted(requote, 30_000))).toStrictEqual({
      ok: true,
      value: { quote: requote, card: { version: 3, openedAtMs: 30_000, expiresAtMs: 90_000 } },
    });
  });

  it("confirms when the new minimum out is better", () => {
    const requote = { quotedAtMs: 29_000, minOutBase: 1_200_000n };
    expect(confirmRequote(requoted(requote))).toStrictEqual({
      ok: true,
      value: { quote: requote },
    });
  });

  it("refuses a re-quote that is itself stale", () => {
    const requote = { quotedAtMs: 19_999, minOutBase: 1_000_000n };
    const stale = { ok: false, error: "quote_stale" };
    expect(confirmRequote(requoted(requote, 30_000))).toStrictEqual(stale);
    expect(reopenCard(requoted(requote, 30_000))).toStrictEqual(stale);
  });

  it("refuses a re-quote on an old or expired card", () => {
    const requote = { quotedAtMs: 69_000, minOutBase: 900_000n };
    expect(reopenCard(requoted(requote, 30_000, 1))).toStrictEqual({
      ok: false,
      error: "card_changed",
    });
    expect(confirmRequote(requoted(requote, 70_000))).toStrictEqual({
      ok: false,
      error: "expired",
    });
  });

  it("names the old card before a stale re-quote", () => {
    const stale = { quotedAtMs: 0, minOutBase: 900_000n };
    expect(confirmRequote(requoted(stale, 30_000, 1))).toStrictEqual({
      ok: false,
      error: "card_changed",
    });
  });

  it("asks again when the re-quote lost its price", () => {
    const requote = { quotedAtMs: 29_000 };
    expect(confirmRequote(requoted(requote))).toStrictEqual({ ok: false, error: "quote_worse" });
  });
});

describe("the card timer", () => {
  it("expires the card at its expiry and not before", () => {
    const early: GuardInput<"card_timer_fired"> = {
      status: awaiting,
      trigger: { type: "card_timer_fired" },
      nowMs: 69_999,
    };
    expect(expireCard(early)).toStrictEqual({ ok: false, error: "not_expired" });
    expect(expireCard({ ...early, nowMs: 70_000 })).toStrictEqual({ ok: true, value: {} });
  });

  it("expires an intent that has no card", () => {
    const input: GuardInput<"card_timer_fired"> = {
      status: withoutCard,
      trigger: { type: "card_timer_fired" },
      nowMs: 0,
    };
    expect(expireCard(input)).toStrictEqual({ ok: true, value: {} });
  });
});
