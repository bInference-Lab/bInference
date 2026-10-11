import { createDeadline, type Deadline } from "@binference/core";
import type { ToolCall } from "./model-message.js";
import { type CallResult, recordResult } from "./record-call.js";
import { settleBy } from "./settle-by.js";
import { createStopGrace } from "./stop-grace.js";
import type { ReadyCall, ToolOutcome } from "./turn-ports.js";
import type { TurnRun } from "./turn-run.js";

/** A call of a batch with its number in the turn, from 1, which names its proposal's key. */
export interface NumberedCall {
  readonly call: ToolCall;
  readonly ordinal: number;
}

const unknownProposal =
  "outcome unknown: the engine did not answer, and this proposal is never sent again";

/** The key a turn's proposal is sent with: the turn and the call's number, the same on every try. */
function proposalKeyOf(turnId: string, ordinal: number): string {
  return `${turnId}.${String(ordinal)}`;
}

function failedText(run: TurnRun, deadline: Deadline): string {
  if (run.halted.aborted) {
    return "stopped before it finished: the turn was stopped";
  }
  return deadline.signal.aborted
    ? `failed: no answer within ${String(run.limits.toolTimeoutMs / 1000)} seconds`
    : "failed: the tool stopped with an error";
}

function failedResult(text: string): CallResult {
  return { text, isError: true, outside: false, ran: true };
}

function resultOf(ready: ReadyCall, outcome: ToolOutcome): CallResult {
  return {
    text: outcome.text,
    isError: outcome.isError,
    outside: ready.outside || outcome.outside === true,
    ran: true,
  };
}

/** A read or control call's result, and whether its tool asked to end the turn. */
export interface CallEnd {
  readonly result: CallResult;
  readonly endsTurn: boolean;
}

/**
 * Runs a read or control call's tool, stopped by the turn's halt or its time limit. A tool that
 * throws gets an error result; nothing is written.
 */
export async function executeCall(
  run: TurnRun,
  numbered: NumberedCall,
  ready: ReadyCall,
): Promise<CallEnd> {
  const deadline = createDeadline({
    clock: run.parts.clock,
    signal: run.halted,
    timeoutMs: run.limits.toolTimeoutMs,
  });
  const idempotencyKey = proposalKeyOf(run.turnId, numbered.ordinal);
  const context = { signal: deadline.signal, idempotencyKey };
  const settled = await settleBy(async () => ready.run(context), {
    signal: deadline.signal,
    clock: run.parts.clock,
  });
  deadline.clear();
  if (settled.kind !== "value") {
    return { result: failedResult(failedText(run, deadline)), endsTurn: false };
  }
  return { result: resultOf(ready, settled.value), endsTurn: settled.value.endsTurn === true };
}

/**
 * Runs a read or control call in order: written before it runs, its result written when it
 * returns. Answers whether its tool asked to end the turn.
 */
export async function runToolCall(
  run: TurnRun,
  numbered: NumberedCall,
  ready: ReadyCall,
): Promise<boolean> {
  await run.parts.journal.toolCall(numbered.call, run.writes);
  const end = await executeCall(run, numbered, ready);
  await recordResult(run, numbered.call, end.result);
  return end.endsTurn;
}

/**
 * Runs the turn's proposal (runtime spec, section 6.1): the turn commits, the call and the
 * committed mark are written in one write, and only then does the tool reach the engine. A stop
 * gives a call already sent a short grace. A call with no answer has an unknown outcome: the turn
 * halts, and the call is never sent again.
 */
export async function runProposal(
  run: TurnRun,
  numbered: NumberedCall,
  ready: ReadyCall,
): Promise<void> {
  const { call, ordinal } = numbered;
  const idempotencyKey = proposalKeyOf(run.turnId, ordinal);
  run.tally.commit();
  await run.parts.journal.proposal({ call, idempotencyKey }, run.writes);
  const { clock } = run.parts;
  const grace = createStopGrace(run.halted, clock, run.limits.stopGraceMs);
  const timeoutMs = run.limits.proposeTimeoutMs;
  const deadline = createDeadline({ clock, signal: grace.signal, timeoutMs });
  const context = { signal: deadline.signal, idempotencyKey };
  const settled = await settleBy(async () => ready.run(context), {
    signal: deadline.signal,
    clock: run.parts.clock,
  });
  // An answer after the deadline is no answer: the engine may hold the proposal or not.
  const known = settled.kind === "value" && !deadline.signal.aborted;
  deadline.clear();
  grace.clear();
  if (!known) {
    run.halt("proposal_unknown");
  }
  await recordResult(
    run,
    call,
    known ? resultOf(ready, settled.value) : failedResult(unknownProposal),
  );
}
