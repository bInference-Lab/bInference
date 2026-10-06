import type { Authorization } from "./authorization.js";
import type { IntentKind } from "./intent-kind.js";
import type { IntentReason } from "./intent-reason.js";
import type { IntentState } from "./intent-state.js";

/**
 * Who proposed an intent: the agent runtime, an MCP client, the owner on a surface (a rescue, for
 * example), or the engine for an auto order or webhook rule fill.
 */
export type IntentProposer = "agent_runtime" | "mcp_client" | "owner" | "engine";

/** A venue's quote for an intent, as its card shows it. */
export interface QuoteTerms {
  /** Epoch milliseconds when the venue quoted. */
  readonly quotedAtMs: number;
  /** The minimum output in base units; absent for a kind without a price, such as a send. */
  readonly minOutBase?: bigint;
}

/** One version of an intent's card. A worse re-quote opens the next version. */
export interface CardTerms {
  readonly version: number;
  readonly openedAtMs: number;
  /** No answer by then is a no: the card timer moves the intent to `expired`. */
  readonly expiresAtMs: number;
}

/**
 * The part of an intent the state machine reads and writes. The store keeps it with the rest of the
 * intent and writes it back in the same transaction as the intent event, under the row version it
 * read.
 */
export interface IntentStatus {
  readonly state: IntentState;
  readonly kind: IntentKind;
  readonly proposer: IntentProposer;
  /**
   * The intent runs in paper mode: it fills at its quote and never signs. A rescue never does, as
   * it runs live whatever the agent's mode (decision 0100).
   */
  readonly isPaper: boolean;
  /** The proposing turn read outside content. */
  readonly hasOutsideContent: boolean;
  /** Epoch milliseconds of the last transition. */
  readonly changedAtMs: number;
  /** Set with `rejected_policy`, `risk_blocked`, `failed_check` and `failed_onchain`. */
  readonly reason?: IntentReason;
  readonly authorizedBy?: Authorization;
  readonly quote?: QuoteTerms;
  readonly card?: CardTerms;
}
