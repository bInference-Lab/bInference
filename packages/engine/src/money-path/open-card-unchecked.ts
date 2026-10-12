import type { JsonValue } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import { cardRulesOf } from "../agents/card-rules-of.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import type { IntentState } from "../intents/intent-state.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import { type AdvanceParts, advanceIntent } from "./advance-intent.js";

/** One move toward the card, and the state it reaches when nothing else moved the intent. */
interface CardStep {
  readonly move: { readonly trigger: IntentTrigger } & Pick<IntentMove, "fields">;
  readonly to: IntentState;
}

// Moves the intent through each step in turn; one another write moved first ends the run there.
async function through(
  advance: AdvanceParts,
  snapshot: IntentSnapshot,
  steps: readonly CardStep[],
): Promise<IntentSnapshot> {
  const [first, ...rest] = steps;
  if (first === undefined) {
    return snapshot;
  }
  const moved = await advanceIntent(advance, snapshot, first.move);
  return moved.record.state === first.to ? through(advance, moved, rest) : moved;
}

// The auto test runs on facts that let nothing through without a card: such an intent's kind
// never passes it (spec 6, section 5).
function authorizationOf(
  settings: AgentSettings,
  engine: { readonly isLocked: boolean },
): IntentTrigger<"authorization_checked"> {
  const { limits, approvalMode } = settings;
  const facts = {
    approvalMode: approvalMode.mode,
    modeVersion: approvalMode.version,
    isLocked: engine.isLocked,
    isInsideOwnPositions: false,
    sellsDeniedToken: false,
    valueUsdMicros: 0n,
    perTradeCapUsdMicros: limits.perTradeUsdMicros,
    rollingDayCapUsdMicros: limits.rollingDayUsdMicros,
    rollingDaySpentUsdMicros: 0n,
    feePerGasNativeBase: 0n,
    networkFeeCapNativeBase: 0n,
    hasUnlistedSpender: false,
  };
  return {
    type: "authorization_checked",
    check: { by: "auto_mode", facts },
    cards: cardRulesOf(limits),
  };
}

/**
 * Takes an intent with no policy, venue, risk or simulation step of its own, such as an unfreeze
 * (decision 0128) or an auto order's card (decision 0189), from `proposed` to its card: its quote
 * is the document the card shows, so the card's terms hash binds it, and its kind never passes the
 * auto test. A move another write made first ends the run where that write left the intent.
 */
export async function openCardUnchecked(
  advance: AdvanceParts,
  run: {
    readonly proposed: IntentSnapshot;
    readonly quote: JsonValue;
    readonly quotedAtMs: number;
    readonly isLocked: boolean;
  },
): Promise<IntentSnapshot> {
  const { quote, quotedAtMs } = run;
  const simulated = await through(advance, run.proposed, [
    { move: { trigger: { type: "policy_passed" } }, to: "checked" },
    {
      move: { trigger: { type: "quote_built", quote: { quotedAtMs } }, fields: { quote } },
      to: "quoted",
    },
    { move: { trigger: { type: "risk_passed" } }, to: "assessed" },
    { move: { trigger: { type: "simulation_matched" } }, to: "simulated" },
  ]);
  if (simulated.record.state !== "simulated") {
    return simulated;
  }
  const trigger = authorizationOf(simulated.settings, run);
  return advanceIntent(advance, simulated, { trigger });
}
