import type { Bps, Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { authorizeIntent, openCard } from "./authorization-guards.js";
import type { AutoModeFacts } from "./auto-mode.js";
import type { CardRules } from "./card-rules.js";
import type { IntentStatus } from "./intent-status.js";
import type { AuthorizationCheck } from "./intent-trigger.js";
import type { GuardInput } from "./transition-guard.js";

const cards: CardRules = {
  tradeExpiryMs: 60_000,
  otherExpiryMs: 600_000,
  requoteAfterMs: 10_000,
  requoteToleranceBps: 50 as Bps,
};

const autoFacts: AutoModeFacts = {
  approvalMode: "auto",
  modeVersion: 9,
  isLocked: false,
  isInsideOwnPositions: false,
  sellsDeniedToken: false,
  valueUsdMicros: 20_000_000n,
  perTradeCapUsdMicros: 100_000_000n,
  rollingDayCapUsdMicros: 500_000_000n,
  rollingDaySpentUsdMicros: 0n,
  feePerGasNativeBase: 50_000_000n,
  networkFeeCapNativeBase: 1_000_000_000n,
  hasUnlistedSpender: false,
};

const order = "ord_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"ord">;
const rule = "whr_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"whr">;

const simulated: IntentStatus = {
  state: "simulated",
  kind: "swap",
  proposer: "agent_runtime",
  isPaper: false,
  hasOutsideContent: false,
  changedAtMs: 0,
};

const fill: IntentStatus = { ...simulated, proposer: "engine", authorizedBy: { order } };

function input(
  status: IntentStatus,
  check: AuthorizationCheck,
  nowMs = 5_000,
): GuardInput<"authorization_checked"> {
  return { status, trigger: { type: "authorization_checked", check, cards }, nowMs };
}

function expiryOf(verdict: ReturnType<typeof openCard>): number | undefined {
  return verdict.ok ? verdict.value.card?.expiresAtMs : undefined;
}

const valid: AuthorizationCheck = { by: "fill", isValid: true };
const auto: AuthorizationCheck = { by: "auto_mode", facts: autoFacts };
const manual: AuthorizationCheck = {
  by: "auto_mode",
  facts: { ...autoFacts, approvalMode: "manual" },
};

describe("authorizing an intent at simulated", () => {
  it("confirms a fill whose order or webhook rule still holds", () => {
    expect(authorizeIntent(input(fill, valid))).toStrictEqual({ ok: true, value: {} });
    const ruleFill = { ...fill, authorizedBy: { webhookRule: rule, alertId: "a-1" } };
    expect(authorizeIntent(input(ruleFill, valid))).toStrictEqual({ ok: true, value: {} });
  });

  it("refuses a fill whose order or rule no longer holds", () => {
    const invalid: AuthorizationCheck = { by: "fill", isValid: false };
    expect(authorizeIntent(input(fill, invalid))).toStrictEqual({
      ok: false,
      error: "fill_invalid",
    });
  });

  it("records the auto mode as the authorization when the auto test passes", () => {
    expect(authorizeIntent(input(simulated, auto))).toStrictEqual({
      ok: true,
      value: { authorizedBy: { approvalMode: "auto", modeVersion: 9 } },
    });
  });

  it("leaves an intent that fails the auto test to the card", () => {
    expect(authorizeIntent(input(simulated, manual))).toStrictEqual({
      ok: false,
      error: "auto_mode_refused",
    });
  });

  it("refuses a check that does not match the intent", () => {
    const mismatch = { ok: false, error: "authorization_mismatch" };
    expect(authorizeIntent(input(fill, auto))).toStrictEqual(mismatch);
    expect(authorizeIntent(input(simulated, valid))).toStrictEqual(mismatch);
    const autoAuthorized: IntentStatus = {
      ...simulated,
      authorizedBy: { approvalMode: "auto", modeVersion: 1 },
    };
    expect(authorizeIntent(input(autoAuthorized, valid))).toStrictEqual(mismatch);
    expect(authorizeIntent(input(autoAuthorized, auto))).toStrictEqual(mismatch);
  });
});

describe("opening the first card", () => {
  it("opens card version 1 with a trade's expiry for a swap", () => {
    expect(openCard(input(simulated, manual, 5_000))).toStrictEqual({
      ok: true,
      value: { card: { version: 1, openedAtMs: 5_000, expiresAtMs: 65_000 } },
    });
  });

  it("gives a send, a rescue, a launch and an approval revoke the longer expiry", () => {
    const kinds = [
      "send",
      "rescue",
      "registerIdentity",
      "lend",
      "stake",
      "bridge",
      "launchToken",
      "revokeApproval",
    ] as const;
    const expiries = kinds.map((kind) => openCard(input({ ...simulated, kind }, manual, 0)));
    expect(expiries.map(expiryOf)).toStrictEqual(kinds.map(() => 600_000));
  });

  it("gives trades and CEX orders the shorter expiry", () => {
    const expiries = (["buy", "sell", "cexOrder"] as const).map((kind) =>
      openCard(input({ ...simulated, kind }, manual, 0)),
    );
    expect(expiries.map(expiryOf)).toStrictEqual([60_000, 60_000, 60_000]);
  });

  it("opens a card in auto mode for a sale out of a token on the deny list", () => {
    const denied: AuthorizationCheck = {
      by: "auto_mode",
      facts: { ...autoFacts, sellsDeniedToken: true },
    };
    expect(openCard(input(simulated, denied, 0)).ok).toBe(true);
    expect(authorizeIntent(input(simulated, denied))).toStrictEqual({
      ok: false,
      error: "auto_mode_refused",
    });
  });

  it("opens a card in auto mode for a fee per gas above the network fee cap", () => {
    const pricey: AuthorizationCheck = {
      by: "auto_mode",
      facts: { ...autoFacts, feePerGasNativeBase: 1_000_000_001n },
    };
    expect(openCard(input(simulated, pricey, 0)).ok).toBe(true);
    expect(authorizeIntent(input(simulated, pricey)).ok).toBe(false);
  });

  it("opens no card for an intent the auto mode authorizes", () => {
    expect(openCard(input(simulated, auto))).toStrictEqual({ ok: false, error: "needs_no_card" });
  });

  it("opens no card for a fill", () => {
    const mismatch = { ok: false, error: "authorization_mismatch" };
    expect(openCard(input(fill, valid))).toStrictEqual(mismatch);
    expect(openCard(input(fill, manual))).toStrictEqual(mismatch);
    expect(openCard(input(simulated, valid))).toStrictEqual(mismatch);
  });
});
