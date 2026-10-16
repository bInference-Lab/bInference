import { createDeadline } from "@binference/core";
import type { TurnReport } from "./chat-turn.js";
import { notRunText } from "./not-run.js";
import { unknownProposal } from "./run-tool-call.js";
import { settleBy } from "./settle-by.js";
import type { TurnStatusLine } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";
import type { LoopEnd } from "./turn-step.js";

/** How a turn ends after a port threw: failed, the engine named as the failure. */
export const portFailure: LoopEnd = {
  outcome: "failed",
  status: { line: "failed", failure: "engine" },
};

// One end write, bounded by its own time and settled whatever it does: true when it was done.
async function bestEffort(run: TurnRun, write: (signal: AbortSignal) => Promise<void>) {
  const { clock } = run.parts;
  const timeoutMs = run.limits.endWriteTimeoutMs;
  const deadline = createDeadline({ clock, signal: run.writes, timeoutMs });
  const settled = await settleBy(async () => write(deadline.signal), {
    signal: deadline.signal,
    clock,
  });
  deadline.clear();
  return settled.kind === "value";
}

/**
 * Gives each call the journal holds without a result its result, as far as the journal still
 * takes writes: a proposal's outcome is unknown, any other call ended with the turn.
 */
export async function answerOpenCalls(run: TurnRun): Promise<void> {
  for (const { call, proposal } of run.open()) {
    const text = proposal ? unknownProposal : notRunText("engine");
    const result = { callId: call.id, name: call.name, text, isError: true, outside: false };
    // oxlint-disable-next-line eslint/no-await-in-loop -- results keep the calls' order
    await bestEffort(run, async (signal) =>
      run.parts.journal.toolResult({ ...result, ran: proposal }, signal),
    );
  }
}

async function sayAndStatus(run: TurnRun, status: TurnStatusLine | undefined): Promise<boolean> {
  const { engine } = run.parts;
  const { lastText } = run.tally.now();
  const said = lastText === "" || (await bestEffort(run, async (s) => engine.say(lastText, s)));
  const line = said ? status : portFailure.status;
  const shown = line === undefined || (await bestEffort(run, async (s) => engine.status(line, s)));
  return said && shown;
}

/**
 * Ends a turn in the order the runtime spec gives (section 11): its final text, its status line,
 * its end in the journal, then `turn/end`. A turn that ends well with no line of its own ends with
 * the closing line a tool gave it. Each write is best effort with its own time limit, so a
 * port that fails or never answers still lets the turn end; any such failure ends it `failed`.
 */
export async function endTurn(run: TurnRun, end: LoopEnd): Promise<TurnReport> {
  run.tally.enter("ending");
  const { closingLine } = run.tally.now();
  const closing = end.outcome === "ok" && closingLine !== undefined;
  const status = end.status ?? (closing ? { line: closingLine } : undefined);
  const shown = await sayAndStatus(run, status);
  const ended = shown ? end.outcome : portFailure.outcome;
  const { heldBack, committed, toolCalls, modelCalls } = run.tally.now();
  const journaled = await bestEffort(run, async (signal) =>
    run.parts.journal.end({ outcome: ended, heldBack }, signal),
  );
  const outcome = journaled ? ended : portFailure.outcome;
  const told = await bestEffort(run, async (signal) => run.parts.engine.end(outcome, signal));
  run.tally.enter("ended");
  const final = told ? outcome : portFailure.outcome;
  return { state: "ended", outcome: final, committed, heldBack, toolCalls, modelCalls };
}
