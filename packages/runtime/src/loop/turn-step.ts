import type { TurnOutcome } from "@binference/store";
import type { BatchEnd } from "./batch-call.js";
import { canMerge } from "./can-merge.js";
import type { OwnerMessage } from "./model-message.js";
import { type ModelAnswer, type ModelFault, readModelResponse } from "./read-model-response.js";
import { markTurn, recordNotRun } from "./record-call.js";
import { runToolBatch } from "./tool-batch.js";
import { endOfHalt, haltOf } from "./turn-halt.js";
import type { TurnStatusLine } from "./turn-ports.js";
import type { TurnRun } from "./turn-run.js";

/** How a turn's loop ended, and the status line it ends with, if any. */
export interface LoopEnd {
  readonly outcome: TurnOutcome;
  readonly status?: TurnStatusLine;
}

/** A step either ends the loop or asks for the next model call. */
export type StepEnd = LoopEnd | "next";

const ok: LoopEnd = { outcome: "ok" };

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

// What the model wrote stays in the transcript and the conversation, cut off or failed alike.
async function keepResponse(run: TurnRun, response: ModelAnswer | ModelFault): Promise<void> {
  if (!response.ok && response.text === "" && response.reasoning === "") {
    return;
  }
  await run.parts.journal.response(
    { text: response.text, reasoning: response.reasoning },
    run.writes,
  );
  const toolCalls = response.ok ? response.toolCalls : [];
  run.messages.push({
    role: "agent",
    text: response.text,
    reasoning: response.reasoning,
    toolCalls,
  });
  run.tally.keepText(response.text);
}

function endOfFault(run: TurnRun, fault: ModelFault): LoopEnd {
  if (run.halted.aborted) {
    return endOfHalt(haltOf(run.halted));
  }
  // A provider that refused for its own safety rules ends the turn with what the model wrote.
  if (fault.failure === "refused") {
    return ok;
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
    return endOfHalt(haltOf(run.halted));
  }
  const { committed } = run.tally.now();
  if (committed) {
    return { outcome: "ok", status: committedStatus(run) };
  }
  if (batch.askedOwner) {
    return ok;
  }
  if (batch.reachedLimit) {
    return { outcome: "loop", status: { line: "toolCallLimit" } };
  }
  if (batch.joined.length === 0 && canMerge(run)) {
    await join(run, await run.parts.merge.take(run.writes));
  }
  return "next";
}

// Merge point 3: a response with no tool call would end the turn, unless messages wait to join.
async function afterAnswer(run: TurnRun): Promise<StepEnd> {
  if (run.halted.aborted) {
    return endOfHalt(haltOf(run.halted));
  }
  if (!canMerge(run)) {
    return ok;
  }
  const waiting = await run.parts.merge.take(run.writes);
  await join(run, waiting);
  return waiting.length > 0 ? "next" : ok;
}

// A response cut off at its output limit may hold a call whose arguments never ended: none runs.
async function cutOff(run: TurnRun, answer: ModelAnswer): Promise<BatchEnd> {
  run.tally.countToolCalls(answer.toolCalls.length);
  for (const call of answer.toolCalls) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- results keep the calls' order
    await recordNotRun(run, call, "cut_off");
  }
  return { askedOwner: false, joined: [], reachedLimit: false };
}

async function onAnswer(run: TurnRun, answer: ModelAnswer): Promise<StepEnd> {
  if (answer.toolCalls.length === 0) {
    return afterAnswer(run);
  }
  const batch =
    answer.stop === "length"
      ? await cutOff(run, answer)
      : await runToolBatch(run, answer.toolCalls);
  return afterBatch(run, batch);
}

/**
 * One step of the turn (runtime spec, section 4.2): a model call, then its tool batch. A halt, a
 * failure with no next step, a committed batch, a question to the owner, or an answer with no
 * call and no waiting message ends the loop; anything else asks for the next model call.
 */
export async function takeStep(run: TurnRun): Promise<StepEnd> {
  if (run.halted.aborted) {
    return endOfHalt(haltOf(run.halted));
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
  const response = await readModelResponse(run.parts.transport.stream(request, run.halted), {
    signal: run.halted,
    clock: run.parts.clock,
  });
  await keepResponse(run, response);
  return response.ok ? onAnswer(run, response) : endOfFault(run, response);
}
