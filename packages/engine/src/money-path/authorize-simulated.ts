import type { ChainFamily } from "@binference/chain";
import { cardRulesOf } from "../agents/card-rules-of.js";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { FillAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { FillBreach } from "../intents/intent-reason.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import type { PolicyPass } from "../policy/check-policy.js";
import { approvesLaunchContract } from "../venues/launch-contracts.js";
import type { TradePlan } from "../venues/venue-host.js";
import { type AdvanceParts, advanceIntent } from "./advance-intent.js";
import { authorizationCheckOf } from "./authorization-check-of.js";
import type { WalletFacts } from "./wallet-facts.js";

/**
 * An auto order's fill (decision 0195): the order that authorizes it, the order's mode, which the
 * fill runs in whatever the agent's mode is now, and the check that holds its chosen quote to the
 * order at `simulated`, answering the first bound it breaks.
 */
/** A fill's check in the agent's line: the first bound it breaks, or none. */
type FillCheckInLine = (call: { readonly signal: AbortSignal }) => Promise<FillBreach | undefined>;

export interface FillProposal {
  readonly authorization: FillAuthorization;
  readonly isPaper: boolean;
  /** The decimals of the order's token, which the fill's notice prices a whole token by. */
  readonly decimals: number;
  /**
   * Reads, before the agent's line of confirmations, what the fill's check needs from outside it,
   * such as the other side's USD price (decision 0197), and answers the check the line runs.
   */
  readonly check: (
    simulated: IntentSnapshot,
    call: { readonly signal: AbortSignal },
  ) => Promise<FillCheckInLine>;
}

/** What the authorization at `simulated` reads, and moves the intent through. */
export interface AuthorizeParts extends AdvanceParts {
  /** The rolling cap each confirmation is checked against, one agent's at a time. */
  readonly gate: CapGate;
  /** Whether the engine is locked: no live intent is authorized by auto mode while it is. */
  readonly isLocked: () => boolean;
  /** The wallet's facts as the proposal read them. */
  readonly wallet: WalletFacts;
  /** The family of the wallet's chain, which reads the spenders of the plan's approvals. */
  readonly family: ChainFamily;
  readonly fill?: FillProposal;
}

/** The route the best quote chose: the policy's pass on it, and its plan. */
export interface ChosenPlan {
  readonly pass: PolicyPass;
  readonly plan: TradePlan;
}

// A fill is held to its order, then to the rolling cap.
async function fillTrigger(
  parts: AuthorizeParts,
  simulated: IntentSnapshot,
  inLine: FillCheckInLine,
): Promise<IntentTrigger<"authorization_checked">> {
  const { signal } = parts;
  const bound = await inLine({ signal });
  const fits = bound !== undefined || (await parts.gate.fits(simulated, { signal }));
  const breach = bound ?? (fits ? undefined : "daily_cap");
  const check = breach === undefined ? { by: "fill" as const } : { by: "fill" as const, breach };
  return { type: "authorization_checked", check, cards: cardRulesOf(simulated.settings.limits) };
}

// The auto test reads the agent as the move to `simulated` read it back, so a switch to manual
// during the run asks at once, and reads what the agent spent at the gate, as every earlier
// confirmation of the agent left it (decision 0136).
async function autoTrigger(
  parts: AuthorizeParts,
  simulated: IntentSnapshot,
  chosen: ChosenPlan,
): Promise<IntentTrigger<"authorization_checked">> {
  const { pass } = chosen;
  const spent = await parts.gate.spent(simulated, { signal: parts.signal });
  return authorizationCheckOf({
    settings: simulated.settings,
    pass:
      pass.figures === undefined
        ? pass
        : { ...pass, figures: { ...pass.figures, rollingDaySpentUsdMicros: spent } },
    wallet: parts.wallet,
    isLocked: parts.isLocked() && !simulated.record.isPaper,
    hasUnlistedSpender: approvesLaunchContract(chosen.plan, parts.family),
  });
}

/**
 * Step 6 of the money path at `simulated`, in the agent's line of confirmations (decision 0136):
 * a fill is held to its order's bounds and the rolling cap, and confirmed or ended with the first
 * it breaks (decision 0195); any other intent meets the auto test, or opens its card.
 */
export async function authorizeSimulated(
  parts: AuthorizeParts,
  simulated: IntentSnapshot,
  chosen: ChosenPlan,
): Promise<IntentSnapshot> {
  const { gate, fill } = parts;
  const inLine =
    fill === undefined ? undefined : await fill.check(simulated, { signal: parts.signal });
  return gate.serially(simulated.record.agentId, async () => {
    const trigger =
      inLine === undefined
        ? await autoTrigger(parts, simulated, chosen)
        : await fillTrigger(parts, simulated, inLine);
    return advanceIntent(parts, simulated, { trigger });
  });
}
