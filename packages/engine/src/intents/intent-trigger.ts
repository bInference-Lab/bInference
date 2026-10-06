import type { CardRules } from "./card-rules.js";
import type {
  PolicyRejection,
  QuoteFailure,
  RiskReason,
  SimulationFailure,
} from "./intent-reason.js";
import type { QuoteTerms } from "./intent-status.js";

/**
 * Every trigger that can move an intent (spec 6, section 3), named for what happened. A step that
 * owns a check reports its outcome; the state machine decides the next state.
 */
export const triggerTypes = [
  "policy_passed",
  "policy_refused",
  "quote_built",
  "quote_failed",
  "risk_passed",
  "risk_refused",
  "simulation_matched",
  "simulation_failed",
  "authorization_checked",
  "confirm_tapped",
  "confirm_requoted",
  "deny_tapped",
  "card_timer_fired",
  "cancel_requested",
  "paper_fill_recorded",
  "queue_took",
  "steps_included",
  "step_reverted",
  "step_cancelled",
  "fate_unknown",
  "finality_reached",
  "reorg_seen",
  "sent_step_found",
  "nonce_taken",
  "fills_reconciled",
] as const;

/** The type of a trigger. */
export type TriggerType = (typeof triggerTypes)[number];

/** Who or what withdrew an intent before signing: an `intent/cancel` call, a freeze or a stop. */
export type CancelCause = "request" | "freeze" | "engine_stopping";

/** At `simulated`: whether a fill's auto order or webhook rule still holds within its bounds. */
export interface FillCheck {
  readonly by: "fill";
  readonly isValid: boolean;
}

/** At `simulated`: an intent that is not a fill, which waits for the owner's tap on its card. */
export interface ManualCheck {
  readonly by: "manual";
}

/** What decides at `simulated` whether an intent skips its card. */
export type AuthorizationCheck = FillCheck | ManualCheck;

/** The owner's confirmation record of one card version. */
export interface ConfirmationRecord {
  readonly cardVersion: number;
  readonly expiresAtMs: number;
}

/** What the wallet queue reads as it takes a confirmed intent. */
export interface QueueFacts {
  /** The agent is live, not in paper mode. */
  readonly isAgentLive: boolean;
  /** The policy still passes, checked again as the queue takes the intent. */
  readonly hasPolicyPassed: boolean;
  /** The confirmation record of an intent the owner tapped. */
  readonly confirmation?: ConfirmationRecord;
  /** For an intent with `authorizedBy`: its auto order or webhook rule still holds. */
  readonly isAuthorizationValid?: boolean;
}

/** A trigger that carries nothing but its type. */
type NoFacts = object;

/** The facts each trigger carries, by trigger type. */
export interface TriggerFacts {
  readonly policy_passed: NoFacts;
  readonly policy_refused: { readonly reason: PolicyRejection };
  /** The venue quoted and built the steps, and their decode matches the request. */
  readonly quote_built: { readonly quote: QuoteTerms };
  readonly quote_failed: { readonly reason: QuoteFailure };
  /** The token is verified, or every risk source passed. */
  readonly risk_passed: NoFacts;
  readonly risk_refused: { readonly reason: RiskReason };
  /** The net balance changes match the request, with no other outflow or approval. */
  readonly simulation_matched: NoFacts;
  readonly simulation_failed: { readonly reason: SimulationFailure };
  readonly authorization_checked: {
    readonly check: AuthorizationCheck;
    readonly cards: CardRules;
  };
  /** The owner tapped Confirm, or called `intent/confirm`, on a card version. */
  readonly confirm_tapped: { readonly cardVersion: number; readonly cards: CardRules };
  /** A tap on a stale quote, after the engine quoted and simulated again. */
  readonly confirm_requoted: {
    readonly cardVersion: number;
    readonly requote: QuoteTerms;
    readonly cards: CardRules;
  };
  /** The owner tapped Cancel, or called `intent/deny`. */
  readonly deny_tapped: NoFacts;
  readonly card_timer_fired: NoFacts;
  readonly cancel_requested: { readonly cause: CancelCause; readonly hasSignedStep: boolean };
  /** Paper mode filled the intent at its confirmed quote. */
  readonly paper_fill_recorded: NoFacts;
  readonly queue_took: QueueFacts;
  /** Every step's receipt has status 1; for a rescue, every step has its last outcome. */
  readonly steps_included: NoFacts;
  /** A step's receipt has status 0. Later steps are not sent. */
  readonly step_reverted: NoFacts;
  /** A stuck step was replaced by a cancel at its nonce (spec 6, section 6). */
  readonly step_cancelled: NoFacts;
  /** Startup found a sent step with no known fate. */
  readonly fate_unknown: NoFacts;
  /** The last step's block is final. */
  readonly finality_reached: NoFacts;
  /** A reorg removed a step's block before it was final. */
  readonly reorg_seen: NoFacts;
  /** Reconciliation found the step's transaction at its nonce after all. */
  readonly sent_step_found: NoFacts;
  /** Reconciliation found another transaction at the step's nonce. */
  readonly nonce_taken: NoFacts;
  /** Fills decoded and compared with the simulation. A bridge also reports delivery. */
  readonly fills_reconciled: { readonly isDeliveryReported?: boolean };
}

/** Something that happened to an intent, with the facts the state machine's guards read. */
export type IntentTrigger<K extends TriggerType = TriggerType> = {
  readonly [P in K]: { readonly type: P } & TriggerFacts[P];
}[K];
