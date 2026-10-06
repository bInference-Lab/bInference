import { type Clock, err, ok, type Result } from "@binference/core";
import type { FillAuthorization } from "./authorization.js";
import { type IntentEvent, needsLedgerEntry } from "./intent-event.js";
import type { IntentKind } from "./intent-kind.js";
import { isTerminalState, type IntentState } from "./intent-state.js";
import type { IntentProposer, IntentStatus } from "./intent-status.js";
import type { IntentTrigger, TriggerType } from "./intent-trigger.js";
import type { GuardInput, IntentChange, TransitionProblem } from "./transition-guard.js";
import { type TransitionRow, transitionTable } from "./transition-table.js";

/** Whether the proposing agent exists and is not archived, as the store read it. */
export type AgentStatus = "active" | "archived" | "missing";

/** A new intent: what the state machine checks before it stores one as `proposed`. */
export interface IntentProposal {
  readonly kind: IntentKind;
  readonly proposer: IntentProposer;
  readonly isPaper: boolean;
  readonly hasOutsideContent: boolean;
  readonly agentStatus: AgentStatus;
  /** The auto order or webhook rule of a fill. Only the engine proposes fills. */
  readonly fill?: FillAuthorization;
}

/**
 * Why a proposal was refused. `wrong_proposer`: a fill not from the engine, an engine proposal that
 * is not a fill, or a rescue not from the owner.
 */
export type ProposalProblem = "agent_missing" | "agent_archived" | "wrong_proposer";

/** The intent after a transition, and the event that records it. Store both in one transaction. */
export interface IntentStep {
  readonly status: IntentStatus;
  readonly event: IntentEvent;
}

/**
 * The one owner of intent states (spec 6). It reads the time from the Clock port and nothing else,
 * and never writes: the caller stores the step under the version it read, so a stale write fails.
 */
export interface IntentStateMachine {
  /** Checks a proposal and returns the new intent in `proposed`. */
  propose(proposal: IntentProposal): Result<IntentStep, ProposalProblem>;
  /** Applies a trigger: the first row of the table whose guard passes moves the intent. */
  apply(status: IntentStatus, trigger: IntentTrigger): Result<IntentStep, TransitionProblem>;
}

/** What the state machine reads the time from. */
export interface IntentStateMachineOptions {
  readonly clock: Clock;
}

interface Passed {
  readonly to: IntentState;
  readonly change: IntentChange;
}

function proposalProblem(proposal: IntentProposal): ProposalProblem | undefined {
  if (proposal.agentStatus !== "active") {
    return proposal.agentStatus === "missing" ? "agent_missing" : "agent_archived";
  }
  const isFromEngine = proposal.proposer === "engine";
  if ((proposal.fill !== undefined) !== isFromEngine) {
    return "wrong_proposer";
  }
  return proposal.kind === "rescue" && proposal.proposer !== "owner" ? "wrong_proposer" : undefined;
}

function proposeIntent(
  proposal: IntentProposal,
  nowMs: number,
): Result<IntentStep, ProposalProblem> {
  const problem = proposalProblem(proposal);
  if (problem !== undefined) {
    return err(problem);
  }
  const { kind, proposer, isPaper, hasOutsideContent, fill } = proposal;
  const status: IntentStatus = {
    state: "proposed",
    kind,
    proposer,
    isPaper,
    hasOutsideContent,
    changedAtMs: nowMs,
    ...(fill === undefined ? {} : { authorizedBy: fill }),
  };
  const event: IntentEvent = {
    from: null,
    to: "proposed",
    trigger: "propose",
    atMs: nowMs,
    hasLedgerEntry: needsLedgerEntry("proposed"),
  };
  return ok({ status, event });
}

// Rows are tried in order. When none passes, the first row's problem is the answer.
function firstPassing<K extends TriggerType>(
  rows: readonly TransitionRow<K>[],
  input: GuardInput<K>,
): Result<Passed, TransitionProblem> {
  const [row, ...rest] = rows;
  if (row === undefined) {
    return err("wrong_state");
  }
  const verdict = row.guard(input);
  if (verdict.ok) {
    return ok({ to: row.to, change: verdict.value });
  }
  const next = firstPassing(rest, input);
  return next.ok ? next : verdict;
}

function stepOf(input: GuardInput<TriggerType>, passed: Passed): IntentStep {
  const { status, trigger, nowMs } = input;
  const { cancelCause, ...patch } = passed.change;
  const event: IntentEvent = {
    from: status.state,
    to: passed.to,
    trigger: trigger.type,
    atMs: nowMs,
    hasLedgerEntry: needsLedgerEntry(passed.to),
    ...(patch.reason === undefined ? {} : { reason: patch.reason }),
    ...(cancelCause === undefined ? {} : { cancelCause }),
  };
  return { status: { ...status, ...patch, state: passed.to, changedAtMs: nowMs }, event };
}

function applyTrigger<K extends TriggerType>(
  input: GuardInput<K>,
): Result<IntentStep, TransitionProblem> {
  const { status, trigger } = input;
  if (isTerminalState(status.state)) {
    return err("terminal");
  }
  const rows = transitionTable[trigger.type].filter((row) => row.from.includes(status.state));
  const passed = firstPassing(rows, input);
  return passed.ok ? ok(stepOf(input, passed.value)) : passed;
}

/** Creates the {@link IntentStateMachine}. */
export function createIntentStateMachine(options: IntentStateMachineOptions): IntentStateMachine {
  return {
    propose: (proposal) => proposeIntent(proposal, options.clock.now()),
    apply: (status, trigger) => applyTrigger({ status, trigger, nowMs: options.clock.now() }),
  };
}
