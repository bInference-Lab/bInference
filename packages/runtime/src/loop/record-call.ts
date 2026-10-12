import type { ToolCall } from "./model-message.js";
import type { NotRunReason } from "./not-run.js";
import { notRunText } from "./not-run.js";
import type { ToolResultRecord } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";

/** A result for the transcript and the model, without the call it answers. */
export type CallResult = Omit<ToolResultRecord, "callId" | "name">;

/**
 * Marks the turn as holding outside content, in the engine first: until the engine has the mark,
 * no later call of the turn may run, so a mark it does not take halts the turn.
 */
export async function markTurn(run: TurnRun): Promise<void> {
  if (run.tally.now().outside) {
    return;
  }
  run.tally.markOutside();
  try {
    await run.parts.engine.mark(run.writes);
  } catch {
    run.halt("engine");
  }
  await run.parts.journal.markOutside(run.writes);
}

/**
 * Writes a call's result, adds it to the conversation, marks the turn when it is outside content,
 * and shows the loop guard each call that ran.
 */
export async function recordResult(
  run: TurnRun,
  call: ToolCall,
  result: CallResult,
): Promise<void> {
  await run.parts.journal.toolResult({ callId: call.id, name: call.name, ...result }, run.writes);
  run.messages.push({
    role: "tool",
    callId: call.id,
    name: call.name,
    text: result.text,
    isError: result.isError,
  });
  if (result.ran && run.loopGuard.see(call, result.text)) {
    run.tally.markLooped();
  }
  if (result.outside) {
    await markTurn(run);
  }
}

/** Writes a call that never runs, with the text the model reads for it. */
export async function recordRefused(run: TurnRun, call: ToolCall, text: string): Promise<void> {
  await run.parts.journal.toolCall(call, run.writes);
  await recordResult(run, call, { text, isError: true, outside: false, ran: false });
}

/** Writes a call that never runs, with its "not run" result. */
export async function recordNotRun(
  run: TurnRun,
  call: ToolCall,
  reason: NotRunReason,
): Promise<void> {
  await recordRefused(run, call, notRunText(reason));
}
