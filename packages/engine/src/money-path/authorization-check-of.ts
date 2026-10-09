import type { AgentSettings } from "../agents/agent-record.js";
import { cardRulesOf } from "../agents/card-rules-of.js";
import type { AutoModeFacts } from "../intents/auto-mode.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import type { PolicyPass } from "../policy/check-policy.js";
import type { WalletFacts } from "./wallet-facts.js";

/** What the auto test of a swap reads at `simulated`. */
export interface AuthorizationInput {
  /**
   * The agent's settings read again at `simulated`, so a switch to manual or a stricter cap that
   * landed while the intent ran counts (spec 6, section 5).
   */
  readonly settings: AgentSettings;
  /** The policy's figures and its deny-list mark. */
  readonly pass: PolicyPass;
  /** The wallet's fee per gas and network fee cap. */
  readonly wallet: WalletFacts;
  /** The engine is locked and the swap is live, so nothing could sign it now. */
  readonly isLocked: boolean;
}

/**
 * The trigger that decides at `simulated` whether a swap skips its card: the auto test's facts and
 * the agent's card rules. A swap stays inside the agent's own wallet, and the venue host refuses an
 * approval to a contract the venue did not declare, so neither mark is set here. Without the
 * policy's figures the value counts as over the per-trade cap, so a doubt asks.
 */
export function authorizationCheckOf(
  input: AuthorizationInput,
): IntentTrigger<"authorization_checked"> {
  const { settings, pass, wallet, isLocked } = input;
  const { limits, approvalMode } = settings;
  const facts: AutoModeFacts = {
    approvalMode: approvalMode.mode,
    modeVersion: approvalMode.version,
    isLocked,
    isInsideOwnPositions: false,
    sellsDeniedToken: pass.sellsDeniedToken,
    valueUsdMicros: pass.figures?.valueUsdMicros ?? limits.perTradeUsdMicros + 1n,
    perTradeCapUsdMicros: limits.perTradeUsdMicros,
    rollingDayCapUsdMicros: limits.rollingDayUsdMicros,
    rollingDaySpentUsdMicros: pass.figures?.rollingDaySpentUsdMicros ?? 0n,
    feePerGasNativeBase: wallet.feePerGasNativeBase,
    networkFeeCapNativeBase: wallet.networkFeeCapNativeBase,
    hasUnlistedSpender: false,
  };
  return {
    type: "authorization_checked",
    check: { by: "auto_mode", facts },
    cards: cardRulesOf(limits),
  };
}
