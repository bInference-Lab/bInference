import { describe, expect, it } from "vitest";
import { agentSettingsOf } from "../agents/agent-record.js";
import { cardRulesOf } from "../agents/card-rules-of.js";
import { testAgentDraft, testLimits } from "../intents/test-intents.js";
import { authorizationCheckOf } from "./authorization-check-of.js";

const settings = agentSettingsOf(testAgentDraft({ approvalMode: "auto" }));
const wallet = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 3n,
  networkFeeCapNativeBase: 5n,
  recentOutflows: [],
};
const figures = { valueUsdMicros: 7n, rollingDaySpentUsdMicros: 11n };

describe("the authorization check of a swap", () => {
  it("hands the auto test the mode, the caps, the policy's figures and marks and the fees", () => {
    const pass = { figures, sellsDeniedToken: true };
    expect(authorizationCheckOf({ settings, pass, wallet, isLocked: false })).toStrictEqual({
      type: "authorization_checked",
      check: {
        by: "auto_mode",
        facts: {
          approvalMode: "auto",
          modeVersion: 0,
          isLocked: false,
          isInsideOwnPositions: false,
          sellsDeniedToken: true,
          valueUsdMicros: 7n,
          perTradeCapUsdMicros: testLimits.perTradeUsdMicros,
          rollingDayCapUsdMicros: testLimits.rollingDayUsdMicros,
          rollingDaySpentUsdMicros: 11n,
          feePerGasNativeBase: 3n,
          networkFeeCapNativeBase: 5n,
          hasUnlistedSpender: false,
        },
      },
      cards: cardRulesOf(testLimits),
    });
  });

  it("counts a swap without the policy's figures as over the per-trade cap", () => {
    const pass = { sellsDeniedToken: false };
    const trigger = authorizationCheckOf({ settings, pass, wallet, isLocked: false });
    expect(trigger.check).toMatchObject({
      by: "auto_mode",
      facts: { valueUsdMicros: testLimits.perTradeUsdMicros + 1n, rollingDaySpentUsdMicros: 0n },
    });
  });

  it("tells the auto test that the engine is locked for the swap", () => {
    const pass = { figures, sellsDeniedToken: false };
    const trigger = authorizationCheckOf({ settings, pass, wallet, isLocked: true });
    expect(trigger.check).toMatchObject({ by: "auto_mode", facts: { isLocked: true } });
  });
});
