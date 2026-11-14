import type { ToolCall } from "./model-message.js";
import type { PreparedCall } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";

const unreadable = "not run: the arguments could not be read";

/**
 * The tool box's check of a call against the turn's conversation. A tool box that throws, on
 * arguments it did not expect, refuses that call and breaks nothing.
 */
export function checkedCall(run: TurnRun, call: ToolCall): PreparedCall {
  try {
    return run.parts.tools.prepare(call, run.messages);
  } catch {
    return { ready: false, text: unreadable, cause: "check" };
  }
}
