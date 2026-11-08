import type { HelperRecord } from "@binference/store";
import type { HelperReading, HelperRefusal } from "../helpers/helper-desk.js";
import type { ModelMessage } from "../loop/model-message.js";
import type { ToolOutcome } from "../loop/turn-records.js";
import { maxResultChars } from "./define-tool.js";

// What the agent reads of its helpers (decision 0403). A model reads it, never the owner, so it
// stays English.

const refusals: Readonly<Record<HelperRefusal, string>> = {
  too_many:
    "not run: 4 of your helpers run already. Wait for one to end, stop one with helper_stop, or do the work yourself.",
  unknown_model:
    "not run: model must be <provider>/<model> of a provider the settings configure; leave it out to use your own model.",
  budget:
    "not run: the agent's model budget of the day is spent. Tell the owner, and do the work after the budget resumes.",
  not_found: "not run: you have no helper with that id; helper_list lists yours.",
  not_running: "not run: that helper does not run now; helper_list says where it stands.",
  busy: "not run: 4 follow-ups already wait for that helper; wait for its result, then send more.",
  closing: "not run: binference is stopping; try again after it starts.",
};

/** The result of a refused helper call, with the next step. */
export function refusedHelper(refusal: HelperRefusal): ToolOutcome {
  return { text: refusals[refusal], isError: true };
}

function minutesOf(ms: number): string {
  return `${String(Math.max(0, Math.round(ms / 60_000)))} min`;
}

/** One line of a helper: its id, label, state, times, model and runs. */
export function helperLine(helper: HelperRecord, nowMs: number): string {
  const started = new Date(helper.startedAtMs).toISOString();
  const span =
    helper.endedAtMs === undefined
      ? `running for ${minutesOf(nowMs - helper.startedAtMs)} of ${minutesOf(helper.timeoutMs)}`
      : `${helper.state} after ${minutesOf(helper.endedAtMs - helper.startedAtMs)}, at ${new Date(helper.endedAtMs).toISOString()}`;
  const model = helper.model === undefined ? "" : `, model ${helper.model}`;
  const runs = helper.runs === 1 ? "" : `, ${String(helper.runs)} runs`;
  return `- ${helper.id} "${helper.label}": ${span}; its latest run started ${started}${model}${runs}.`;
}

function cut(text: string): string {
  return text.length <= 600 ? text : `${text.slice(0, 600)}…`;
}

// One message of a helper's conversation, in a line or a few, each kept short.
function messageLine(message: ModelMessage): string {
  if (message.role === "owner") {
    return `[task or follow-up] ${cut(message.text)}`;
  }
  if (message.role === "tool") {
    return `[${message.name} result${message.isError ? ", error" : ""}] ${cut(message.text)}`;
  }
  const calls = message.toolCalls.map((call) => `${call.name} ${cut(call.argumentsText)}`);
  const said = message.text.trim() === "" ? [] : [`[helper] ${cut(message.text)}`];
  return [...said, ...calls.map((call) => `[helper calls] ${call}`)].join("\n");
}

// The newest messages that fit in `room` characters, oldest first.
function lastMessages(messages: readonly ModelMessage[], room: number): readonly string[] {
  const kept: string[] = [];
  let used = 0;
  for (const message of messages.toReversed()) {
    const line = messageLine(message);
    if (line === "" || used + line.length + 1 > room) {
      break;
    }
    kept.unshift(line);
    used += line.length + 1;
  }
  return kept;
}

// The helper's report: its run's final text here, else its newest text in the conversation.
function reportOf(reading: HelperReading): string | undefined {
  const said = reading.run?.said[0];
  if (said !== undefined) {
    return said;
  }
  const last = reading.messages.findLast((message) => message.role === "agent");
  return last?.role === "agent" && last.text.trim() !== "" ? last.text : undefined;
}

// What the helper does now, from its run's newest progress line.
function doingLines({ run }: HelperReading): readonly string[] {
  const doing = run?.running === true ? run.progressKeys.at(-1) : undefined;
  return doing === undefined ? [] : [`Doing now: ${doing.replace("turn.tool.", "")}.`];
}

// The helper's report, cut to 6,000 characters, or that none came yet.
function reportLine(reading: HelperReading): string {
  const report = reportOf(reading);
  if (report === undefined) {
    return "No report yet.";
  }
  return `Report:\n${report.length <= 6_000 ? report : `${report.slice(0, 6_000)}…`}`;
}

// Whether any run of the helper read outside content.
function isOutside({ helper, run }: HelperReading): boolean {
  return helper.outside || run?.marked === true || run?.started?.outside === true;
}

/**
 * What `helper_read` answers: the helper's line, what it does now, its report and its newest
 * messages, within one tool result; outside content when any run of it read some.
 */
export function readingText(reading: HelperReading, nowMs: number): ToolOutcome {
  const head = [helperLine(reading.helper, nowMs), ...doingLines(reading), reportLine(reading)];
  const text = head.join("\n");
  const messages = lastMessages(reading.messages, maxResultChars - text.length - 100);
  const tail = messages.length === 0 ? "" : `\n\nIts newest messages:\n${messages.join("\n")}`;
  return {
    text: `${text}${tail}`,
    isError: false,
    ...(isOutside(reading) ? { outside: true } : {}),
  };
}
