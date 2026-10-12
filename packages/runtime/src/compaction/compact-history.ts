import type { TranscriptEvent } from "@binference/store";
import { callModel } from "../loop/model-call.js";
import { createModelRoute, type TurnRun } from "../loop/turn-run.js";
import { messagesOf, type StoredHistory, type StoredSummary } from "../sessions/conversation.js";
import { cutPoint } from "./cut-point.js";
import { textsOf } from "./event-text.js";
import { missingIdentifiers } from "./identifiers.js";
import { cappedSummary, summaryRequest } from "./summary-prompt.js";
import { estimateMessagesTokens, messageTexts } from "./token-estimate.js";
import type { TurnHistory } from "./turn-history.js";

/** The share of the context window the kept messages may fill (runtime spec, section 7.3). */
const keptShare = 0.4;

/** The history's range to compact, and what stays. */
interface Plan {
  readonly compacted: readonly TranscriptEvent[];
  readonly kept: readonly TranscriptEvent[];
  readonly previous?: StoredSummary;
  /** The texts the model still sees after the summary: the kept events and the turn's own. */
  readonly keptTexts: readonly string[];
}

function planOf(run: TurnRun, history: TurnHistory, windowTokens: number): Plan | undefined {
  const own = run.messages.slice(history.size());
  const room = Math.floor(windowTokens * keptShare) - estimateMessagesTokens(own);
  const { events, summary } = history.stored();
  const cut = cutPoint(events, Math.max(0, room));
  if (cut === undefined) {
    return undefined;
  }
  const kept = events.slice(cut);
  const keptTexts = [...textsOf(kept), ...own.flatMap(messageTexts)];
  const compacted = events.slice(0, cut);
  return summary === undefined
    ? { compacted, kept, keptTexts }
    : { compacted, kept, keptTexts, previous: summary };
}

// The summary model's text, cut to its most, or nothing when its call failed or wrote nothing.
async function summarize(
  run: TurnRun,
  history: TurnHistory,
  ask: { readonly plan: Plan; readonly missing?: readonly string[] },
): Promise<string | undefined> {
  const { plan, missing } = ask;
  const request = summaryRequest({
    locale: history.compaction.locale,
    events: plan.compacted,
    ...(plan.previous === undefined ? {} : { previous: plan.previous.text }),
    ...(missing === undefined ? {} : { missing }),
  });
  const line = { chain: history.compaction.summarizer, route: createModelRoute() };
  const response = await callModel(run, request, line);
  const text = response.ok ? cappedSummary(response.text) : "";
  return text === "" ? undefined : text;
}

function missingFrom(plan: Plan, summary: string): readonly string[] {
  const previous = plan.previous === undefined ? [] : [plan.previous.text];
  return missingIdentifiers({
    compacted: [...previous, ...textsOf(plan.compacted)],
    kept: plan.keptTexts,
    summary,
  });
}

// A summary that keeps every identifier, asking once more with the ones left out; none if the
// second still leaves one out.
async function checkedSummary(run: TurnRun, history: TurnHistory, plan: Plan) {
  const first = await summarize(run, history, { plan });
  if (first === undefined) {
    return undefined;
  }
  const missing = missingFrom(plan, first);
  if (missing.length === 0) {
    return first;
  }
  const second = await summarize(run, history, { plan, missing });
  return second !== undefined && missingFrom(plan, second).length === 0 ? second : undefined;
}

function summaryOf(plan: Plan, text: string): StoredSummary | undefined {
  const first = plan.compacted[0];
  const last = plan.compacted.at(-1);
  if (first === undefined || last === undefined) {
    return undefined;
  }
  const outside = plan.previous?.outside === true || plan.compacted.some((event) => event.outside);
  return { text, fromSeq: plan.previous?.fromSeq ?? first.seq, throughSeq: last.seq, outside };
}

/**
 * Compacts the turn's history to fit a context window of `windowTokens` (runtime spec, section
 * 7.3; decision 0202): the oldest events, up to a cut that keeps at most 40% of the window with the
 * turn's own messages and never splits a call from its result, are summarized by the summary
 * model with the summary before them. The summary must hold every intent, order, alert and
 * schedule id, transaction hash and address of the range that the kept messages do not; the model
 * is asked once more with what it left out, and if one is still missing nothing is written. A
 * written summary is stored, marked outside when its range was, and the conversation's history
 * becomes the summary and the kept events; the turn's own messages stay as they are. Answers
 * whether it wrote one.
 */
export async function compactHistory(run: TurnRun, windowTokens: number): Promise<boolean> {
  const { history } = run;
  const plan = history === undefined ? undefined : planOf(run, history, windowTokens);
  if (history === undefined || plan === undefined) {
    return false;
  }
  const text = await checkedSummary(run, history, plan);
  const summary = text === undefined ? undefined : summaryOf(plan, text);
  if (summary === undefined || run.halted.aborted) {
    return false;
  }
  await run.parts.journal.summary(summary, run.writes);
  const stored: StoredHistory = { summary, events: plan.kept };
  const messages = messagesOf(stored);
  run.messages.splice(0, history.size(), ...messages);
  history.replace(stored, messages.length);
  return true;
}
