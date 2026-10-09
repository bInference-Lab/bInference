import { err, ok, type Result } from "@binference/core";
import type { AutoModeAuthorization } from "./authorization.js";
import type { IntentKind } from "./intent-kind.js";
import type { IntentStatus } from "./intent-status.js";

/** An agent's approval mode (decision 0088): every transaction asks, or auto runs some. */
export type ApprovalMode = "manual" | "auto";

/**
 * Why auto mode leaves an intent to the owner's tap. `manual`: the agent is not in auto mode. The
 * others are the `autoAsks` lines of spec 4, section 3.4: `locked` means the engine is locked, so
 * nothing could sign the intent, `deniedToken` that the intent sells a token on the deny list,
 * `overFeeCap` that its fee per gas is above the network fee cap, and `spender` that a step
 * approves a spender outside the registry.
 */
export type AutoModeRefusal =
  | "manual"
  | "locked"
  | "send"
  | "kind"
  | "deniedToken"
  | "overCap"
  | "overFeeCap"
  | "spender"
  | "outside"
  | "mcp";

/** What the auto test reads beyond the intent, as things stand when the intent is `simulated`. */
export interface AutoModeFacts {
  readonly approvalMode: ApprovalMode;
  /** The mode's version; an auto authorization holds only while it stays the same. */
  readonly modeVersion: number;
  /**
   * The engine is locked and the intent is live, so nothing could sign it: auto mode waits until
   * the owner unlocks (spec 5, section 3). A paper intent signs nothing and is never locked.
   */
  readonly isLocked: boolean;
  /** A lend or stake move stays inside the agent's own positions. */
  readonly isInsideOwnPositions: boolean;
  /** The policy's mark: the intent moves a token on the deny list out of the wallet. */
  readonly sellsDeniedToken: boolean;
  readonly valueUsdMicros: bigint;
  readonly perTradeCapUsdMicros: bigint;
  readonly rollingDayCapUsdMicros: bigint;
  /** What the agent spent in the rolling 24 hours before this intent. */
  readonly rollingDaySpentUsdMicros: bigint;
  /**
   * The most fee per gas the intent's transactions pay, as read when its steps were built, in base
   * units of the chain's native coin (wei on an EVM chain).
   */
  readonly feePerGasNativeBase: bigint;
  /**
   * The chain's network fee cap: the most fee per gas a transaction pays without the owner's tap,
   * in the same units (decision 0102).
   */
  readonly networkFeeCapNativeBase: bigint;
  /** A step approves a spender outside the registry. */
  readonly hasUnlistedSpender: boolean;
}

/** The parts of an intent the auto test reads. */
export type AutoModeSubject = Pick<IntentStatus, "kind" | "proposer" | "hasOutsideContent">;

const sendKinds: ReadonlySet<IntentKind> = new Set<IntentKind>(["send", "bridge", "rescue"]);
const tradeKinds: ReadonlySet<IntentKind> = new Set<IntentKind>(["swap", "buy", "sell"]);
const positionKinds: ReadonlySet<IntentKind> = new Set<IntentKind>(["lend", "stake"]);

function kindRefusal(kind: IntentKind, facts: AutoModeFacts): AutoModeRefusal | undefined {
  if (sendKinds.has(kind)) {
    return "send";
  }
  if (tradeKinds.has(kind) || (positionKinds.has(kind) && facts.isInsideOwnPositions)) {
    return undefined;
  }
  return "kind";
}

function fitsCaps(facts: AutoModeFacts): boolean {
  return (
    facts.valueUsdMicros <= facts.perTradeCapUsdMicros &&
    facts.rollingDaySpentUsdMicros + facts.valueUsdMicros <= facts.rollingDayCapUsdMicros
  );
}

// The checks run in the order spec 6, section 5 lists them; the first that fails names the refusal.
function autoModeRefusal(
  intent: AutoModeSubject,
  facts: AutoModeFacts,
): AutoModeRefusal | undefined {
  if (facts.approvalMode !== "auto") {
    return "manual";
  }
  if (facts.isLocked) {
    return "locked";
  }
  const refusal = kindRefusal(intent.kind, facts);
  if (refusal !== undefined) {
    return refusal;
  }
  if (facts.sellsDeniedToken) {
    return "deniedToken";
  }
  if (!fitsCaps(facts)) {
    return "overCap";
  }
  if (facts.feePerGasNativeBase > facts.networkFeeCapNativeBase) {
    return "overFeeCap";
  }
  if (facts.hasUnlistedSpender) {
    return "spender";
  }
  if (intent.hasOutsideContent) {
    return "outside";
  }
  return intent.proposer === "agent_runtime" ? undefined : "mcp";
}

/**
 * The auto test of spec 6, section 5. It passes only when the agent is in auto mode, the engine is
 * not locked for the intent, the kind is a swap, buy or sell or a lend or stake move inside the
 * agent's own positions, it sells no token on the deny list, the value fits the per-trade and
 * rolling-day caps, the fee per gas is at most the network fee cap, every approval goes to a
 * registry spender, the turn read no outside content, and the agent runtime proposed it. Anything
 * else opens a card.
 */
export function checkAutoMode(
  intent: AutoModeSubject,
  facts: AutoModeFacts,
): Result<AutoModeAuthorization, AutoModeRefusal> {
  const refusal = autoModeRefusal(intent, facts);
  return refusal === undefined
    ? ok({ approvalMode: "auto", modeVersion: facts.modeVersion })
    : err(refusal);
}
