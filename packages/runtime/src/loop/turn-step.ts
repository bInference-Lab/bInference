import type { TurnOutcome } from "@binference/store";
import type { BatchEnd } from "./batch-call.js";
import { canMerge } from "./can-merge.js";
import { callModel } from "./model-call.js";
import type { OwnerMessage, ToolCall } from "./model-message.js";
import type { ModelAnswer, ModelFault } from "./read-model-response.js";
import { markTurn } from "./record-call.js";
import { runCutOffBatch, runToolBatch } from "./tool-batch.js";
import { endOfHalt, haltOf } from "./turn-halt.js";
import type { TurnStatusLine } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";

/** How a turn's loop ended, and the status line it ends with, if any. */
export interface LoopEnd {
  readonly outcome: TurnOutcome;
  readonly status?: TurnStatusLine;
}

/** A step either ends the loop or asks for the next model call. */
export type StepEnd = LoopEnd | "next";

const ok: LoopEnd = { outcome: "ok" };

// The budget ran out on a usage record: no model call follows (runtime spec, section 8.3).
const budgetEnd: LoopEnd = { outcome: "budget" };

/** Adds messages that joined at a merge point after every result before it (invariant 10). */
async function join(run: TurnRun, messages: readonly OwnerMessage[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }
  await run.parts.journal.joined(messages, run.writes);
  run.messages.push(...messages.map((message) => ({ role: "owner" as const, text: message.text })));
  if (messages.some((message) => message.outside)) {
    await markTurn(run);
  }
}

// A call cut off at the output limit may hold half its arguments, which no provider reads back:
// the conversation carries it with empty arguments, beside its "not run" result.
function sentBack(answer: ModelAnswer): readonly ToolCall[] {
  return answer.stop === "length"
    ? answer.toolCalls.map((call) => ({ ...call, argumentsText: "{}" }))
    : answer.toolCalls;
}

// What the model wrote stays in the transcript and the conversation, cut off or failed alike.
async function keepResponse(run: TurnRun, response: ModelAnswer | ModelFault): Promise<void> {
  if (!response.ok && response.text === "" && response.reasoning === "") {
    return;
  }
  const replay = response.ok ? response.replay : undefined;
  const kept = { text: response.text, reasoning: response.reasoning };
  await run.parts.journal.response(replay === undefined ? kept : { ...kept, replay }, run.writes);
  const toolCalls = response.ok ? sentBack(response) : [];
  run.messages.push({
    role: "agent",
    ...kept,
    toolCalls,
    ...(replay === undefined ? {} : { replay }),
  });
  run.tally.keepText(response.text);
}

// A halted turn ends as its halt says; a stop after the engine took the turn's proposal says its
// card is still open (decision 0173).
function haltedEnd(run: TurnRun): LoopEnd {
  const end = endOfHalt(haltOf(run.halted));
  const { committed, proposal } = run.tally.now();
  const cardOpen = end.outcome === "stopped" && committed && proposal === "waits";
  return cardOpen ? { outcome: "stopped", status: { line: "stoppedCardOpen" } } : end;
}

function endOfFault(run: TurnRun, fault: ModelFault): LoopEnd {
  if (run.halted.aborted) {
    return haltedEnd(run);
  }
  // A provider that refused for its own safety rules ends the turn with what the model wrote.
  if (fault.failure === "refused") {
    return ok;
  }
  if (run.tally.now().budgetSpent) {
    return budgetEnd;
  }
  return { outcome: "failed", status: { line: "failed", failure: fault.failure } };
}

// A card waits only for a proposal the engine took; more may follow it after the owner answers.
function committedStatus(run: TurnRun): TurnStatusLine {
  const { proposal, heldBack } = run.tally.now();
  if (proposal !== "waits") {
    return { line: "proposalRefused" };
  }
  return heldBack > 0 ? { line: "moreProposals", count: heldBack } : { line: "proposalWaits" };
}

// Merge point 2, after a batch: waiting messages join before the next model call.
async function afterBatch(run: TurnRun, batch: BatchEnd): Promise<StepEnd> {
  await join(run, batch.joined);
  if (run.halted.aborted) {
    return haltedEnd(run);
  }
  const { committed } = run.tally.now();
  if (committed) {
    return { outcome: "ok", status: committedStatus(run) };
  }
  if (batch.askedOwner) {
    return ok;
  }
  const { looped, budgetSpent } = run.tally.now();
  if (looped) {
    return { outcome: "loop", status: { line: "loop" } };
  }
  if (batch.reachedLimit) {
    return { outcome: "loop", status: { line: "toolCallLimit" } };
  }
  if (budgetSpent) {
    return budgetEnd;
  }
  if (batch.joined.length === 0 && canMerge(run)) {
    await join(run, await run.parts.merge.take(run.writes));
  }
  return "next";
}

// Merge point 3: a response with no tool call would end the turn, unless messages wait to join.
async function afterAnswer(run: TurnRun): Promise<StepEnd> {
  if (run.halted.aborted) {
    return haltedEnd(run);
  }
  if (run.tally.now().budgetSpent) {
    return budgetEnd;
  }
  if (!canMerge(run)) {
    return ok;
  }
  const waiting = await run.parts.merge.take(run.writes);
  await join(run, waiting);
  return waiting.length > 0 ? "next" : ok;
}

async function onAnswer(run: TurnRun, answer: ModelAnswer): Promise<StepEnd> {
  if (answer.toolCalls.length === 0) {
    return afterAnswer(run);
  }
  const batch =
    answer.stop === "length"
      ? await runCutOffBatch(run, answer.toolCalls)
      : await runToolBatch(run, answer.toolCalls);
  return afterBatch(run, batch);
}

/**
 * One step of the turn (runtime spec, section 4.2): a model call, then its tool batch. A halt, a
 * failure with no next step, a committed batch, a question to the owner, the loop guard, a spent
 * budget, or an answer with no call and no waiting message ends the loop; anything else asks for
 * the next model call.
 */
export async function takeStep(run: TurnRun): Promise<StepEnd> {
  if (run.halted.aborted) {
    return haltedEnd(run);
  }
  if (run.tally.now().modelCalls >= run.limits.maxModelCalls) {
    return { outcome: "loop", status: { line: "modelCallLimit" } };
  }
  run.tally.enter("streaming");
  const request = {
    instructions: run.instructions,
    messages: [...run.messages],
    tools: run.parts.tools.declarations,
  };
  const response = await callModel(run, request);
  await keepResponse(run, response);
  return response.ok ? onAnswer(run, response) : endOfFault(run, response);
}
