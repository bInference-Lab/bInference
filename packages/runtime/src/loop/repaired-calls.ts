import { type CallRepair, repairCall } from "../repair/repair-call.js";
import type { RepairStep } from "../repair/repair-step.js";
import { cutResult } from "../tools/define-tool.js";
import { checkedCall } from "./checked-call.js";
import type { ToolCall } from "./model-message.js";
import type { ModelResponse } from "./read-model-response.js";
import type { PreparedCall, ReadyCall, RefusalCause, RefusedCall } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";

// The most calls a turn holds after a repair (decision 0447).
const maxHeldCalls = 3;

// The refusals a repair may read: a call's name, its arguments' JSON, its schema. A check, such as
// a key written twice or an address only a note holds, is never repaired.
const repairable: ReadonlySet<RefusalCause> = new Set(["name", "arguments", "schema"]);

/**
 * A call as the turn runs it and the conversation carries it: by its repaired name and arguments
 * when it has a repair (decision 0447), else as the model wrote it.
 */
export function callAsRead(call: ToolCall): ToolCall {
  return call.repair === undefined
    ? call
    : { id: call.id, name: call.repair.name, argumentsText: call.repair.argumentsText };
}

// A call as the model wrote it, without the repair binference made of it.
function callAsWritten(call: ToolCall): ToolCall {
  return { id: call.id, name: call.name, argumentsText: call.argumentsText };
}

// The repair of one call the tool box refused for its form, when a repair reads it.
function repairOf(run: TurnRun, call: ToolCall): CallRepair | undefined {
  const written = checkedCall(run, call);
  return written.ready || !repairable.has(written.cause)
    ? undefined
    : repairCall(call, run.parts.tools);
}

function isRepairedModel(run: TurnRun): boolean {
  return run.parts.models.models[run.route.at()]?.repairsCalls === true;
}

/**
 * The repair step of a turn (runtime spec, section 5.6): when `models.repairToolCalls` lists the
 * model that answered, each call the tool box refused for its form gets one repair. A failed
 * response, one cut off at its output limit, and one of a model not listed pass as they are.
 */
export function withRepairs(run: TurnRun, response: ModelResponse): ModelResponse {
  if (!response.ok || response.stop === "length" || !isRepairedModel(run)) {
    return response;
  }
  const toolCalls = response.toolCalls.map((call) => {
    const repair = repairOf(run, call);
    return repair === undefined ? call : { ...call, repair };
  });
  return { ...response, toolCalls };
}

function stepsOf(steps: readonly RepairStep[]): string {
  return steps.join(", ");
}

// The text of a held call: nothing ran, and the call as binference read it, to send again. It is
// cut as any result is, so a call near the arguments' size stays within a result's.
function heldCallText(repair: CallRepair): string {
  return cutResult(
    [
      `not run: binference fixed the form of this call before reading it (${stepsOf(repair.steps)}), and only a call that reads runs repaired. Nothing was sent or run. If this is the call you meant, send it again exactly as below, with plain JSON arguments and nothing around them; if not, write the call you meant.`,
      `${repair.name} ${repair.argumentsText}`,
    ].join("\n"),
  );
}

function ranWithNote(ready: ReadyCall, repair: CallRepair): ReadyCall {
  const note = `binference fixed the form of this call before it ran (${stepsOf(repair.steps)}). Write plain JSON arguments with nothing around them.`;
  return {
    ...ready,
    run: async (context) => {
      const outcome = await ready.run(context);
      return { ...outcome, text: `${note}\n${outcome.text}` };
    },
  };
}

/**
 * The tool box's check of a repaired call (runtime spec, section 5.6): a read runs with the
 * repaired arguments, its result led by a line that names the repair; any other call is held, and
 * never runs; a refusal of what the repair read says so first.
 */
export function preparedRepair(run: TurnRun, call: ToolCall, repair: CallRepair): PreparedCall {
  const read = checkedCall(run, callAsRead(call));
  if (!read.ready) {
    const line = `binference fixed the form of this call (${stepsOf(repair.steps)}), and the call it read is refused:`;
    return { ...read, text: `${line}\n${read.text}` };
  }
  return read.kind === "read"
    ? ranWithNote(read, repair)
    : { ready: false, text: heldCallText(repair), cause: "held" };
}

/** A refused call as its batch records it: the call, and the text the model reads for it. */
interface RecordedRefusal {
  readonly call: ToolCall;
  readonly text: string;
}

/**
 * A refused call as its batch records it (decision 0447). A held call counts toward the turn's 3
 * only here, as the model reads it held. Past them, it is recorded as the model wrote it, with the
 * tool box's refusal of what it wrote, and the turn ends after its batch, so the next turn's
 * conversation carries it so.
 */
export function recordedRefusal(
  run: TurnRun,
  call: ToolCall,
  refused: RefusedCall,
): RecordedRefusal {
  if (refused.cause !== "held") {
    return { call, text: refused.text };
  }
  if (run.tally.now().held < maxHeldCalls) {
    run.tally.hold();
    return { call, text: refused.text };
  }
  run.tally.markUnreadable();
  const written = callAsWritten(call);
  const check = checkedCall(run, written);
  // The tool box refused the call as written before its repair, and past the 3 it never runs.
  return { call: written, text: check.ready ? refused.text : check.text };
}
