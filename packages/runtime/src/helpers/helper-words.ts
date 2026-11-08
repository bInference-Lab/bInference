import type { HelperRecord, HelperState } from "@binference/store";
import type { TurnReport } from "../loop/chat-turn.js";

// The words the agent reads of its helpers (decision 0403). A model reads them, never the owner, so
// they stay English.

// The most characters the words of one helper's end hold: what `helper/ended` takes, 8,000.
const maxEndChars = 8_000;

/** How a run ended, beside its state: why a failed run failed. */
export type HelperFailure = "budget" | "loop" | "refused" | "failed";

/** The state a run's report gives, and why a failed run failed. */
export function stateOfReport(report: TurnReport): {
  readonly state: HelperState;
  readonly failure?: HelperFailure;
} {
  if (report.state === "refused") {
    return { state: "failed", failure: report.refusal === "budget" ? "budget" : "refused" };
  }
  if (report.outcome === "ok") {
    return { state: "done" };
  }
  const failure =
    report.outcome === "budget" || report.outcome === "loop" ? report.outcome : "failed";
  return { state: "failed", failure };
}

const failures: Readonly<Record<HelperFailure, string>> = {
  budget: "the agent's model budget of the day is spent",
  loop: "it repeated the same tool call with the same result",
  refused: "binference could not start its run",
  failed: "its run failed: a model or binference did not answer",
};

// How the agent names a helper: its label and its id.
function helperName(helper: Pick<HelperRecord, "label" | "id">): string {
  return `your helper "${helper.label}" (${helper.id})`;
}

// Leaves room for the words around a report in the engine's limit.
function cut(text: string, room: number): string {
  return text.length <= room
    ? text
    : `${text.slice(0, room)}\n[cut: read the rest with helper_read]`;
}

/** What the agent reads when its helper's run ended on its own: done, failed or out of time. */
export function endedText(
  helper: HelperRecord,
  run: { readonly report?: string; readonly failure?: HelperFailure },
): string {
  const name = helperName(helper);
  const room = maxEndChars - 600;
  const report = run.report?.trim() ?? "";
  if (helper.state === "done") {
    const said =
      report === "" ? "It finished with no report." : `Its report:\n${cut(report, room)}`;
    return `[binference: ${name} finished. ${said}\nUse it for the owner's request; read its work with helper_read if you need more.]`;
  }
  const last = report === "" ? "" : ` Its last words:\n${cut(report, room)}\n`;
  if (helper.state === "timed_out") {
    const minutes = String(Math.round(helper.timeoutMs / 60_000));
    return `[binference: ${name} ran out of its ${minutes} minutes.${last} Answer from what it found, or continue it with helper_send.]`;
  }
  const why = failures[run.failure ?? "failed"];
  return `[binference: ${name} failed: ${why}.${last} Read what it did with helper_read, or send it a follow-up with helper_send.]`;
}

/** What the agent reads of its helpers a restart of binference stopped. */
export function stoppedByRestartText(helpers: readonly HelperRecord[]): string {
  const names = helpers.map((helper) => `"${helper.label}" (${helper.id})`).join(", ");
  const text = `[binference: binference restarted, which stopped your helpers: ${names}. Read what each did with helper_read, and continue one with helper_send only if its work is still needed.]`;
  return text.length <= maxEndChars ? text : `${text.slice(0, maxEndChars - 1)}]`;
}
