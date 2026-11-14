import { testCoin, testToken } from "@binference/engine/testing";
import type { ModelRequest, ScriptedReply } from "@binference/runtime/testing";
import type { Timeline } from "./runtime-load-rig.js";

// The scripted models of the runtime's load runs (decision 0442), paced on the shared clock's
// timeline, so time moves only while every call of the runtime waits on it.

type ModelEvent = Exclude<ScriptedReply, (...args: never[]) => object>[number];

// A scripted response made for each model call.
type ReplyOf = (signal: AbortSignal, request: ModelRequest) => AsyncIterable<ModelEvent>;

/** One event of a response at its time after the response began. */
interface Timed {
  readonly atMs: number;
  readonly event: ModelEvent;
}

// Plays a response at a model's pace: each event waits on the timeline for its time.
async function* paced(
  timeline: Timeline,
  signal: AbortSignal,
  events: readonly Timed[],
): AsyncGenerator<ModelEvent> {
  const state = { atMs: 0 };
  for (const { atMs, event } of events) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the events come one after another
    await timeline.wait(atMs - state.atMs, signal);
    state.atMs = atMs;
    yield event;
  }
}

const usage = { inputTokens: 1_000, outputTokens: 200, cachedTokens: 0 };
// A fast model: its first event 400 ms after the call, then a piece of text every 20 ms.
const firstEventMs = 400;
const pieceMs = 20;

// A response whose text arrives in pieces, one every `pieceMs` after the first event.
function answer(text: string, pieces: number): readonly Timed[] {
  const written = Array.from({ length: pieces }, (_, index) => ({
    atMs: firstEventMs + index * pieceMs,
    event: { type: "text", delta: index === 0 ? text : " more" } as const,
  }));
  const done = { type: "done", stop: "end", usage } as const;
  return [...written, { atMs: firstEventMs + pieces * pieceMs, event: done }];
}

// A response that calls the tools, all at once after the first event's wait.
function calls(
  list: readonly { readonly name: string; readonly args: object }[],
): readonly Timed[] {
  const events = list.flatMap((call, index): ModelEvent[] => [
    { type: "toolCallStart", index, id: `${call.name}-${String(index)}`, name: call.name },
    { type: "toolCallDelta", index, delta: JSON.stringify(call.args) },
    { type: "toolCallEnd", index },
  ]);
  const done: ModelEvent = { type: "done", stop: "tool_calls", usage };
  return [...events, done].map((event) => ({ atMs: firstEventMs, event }));
}

// A quote of `units` thousand base units, each one a call of its own to the loop guard.
const quote = (units: number) => ({
  name: "quote",
  args: { from: testCoin, to: testToken, amount: { base: `${String(units)}000` }, reason: "x" },
});

// The reads of one tool round: the portfolio, the token, then quotes of growing amounts, `count`
// in all, no two the same.
function readsOf(count: number): readonly { readonly name: string; readonly args: object }[] {
  const first = [
    { name: "portfolio", args: {} },
    { name: "token_info", args: { asset: testToken } },
  ];
  const quotes = Array.from({ length: Math.max(0, count - first.length) }, (_, at) =>
    quote(at + 1),
  );
  return [...first, ...quotes].slice(0, count);
}

const asks = (request: ModelRequest) => request.tools.some(({ name }) => name === "helper_start");

// The responses since the last owner message of the request, and that message's text.
function placeOf(request: ModelRequest): { readonly step: number; readonly text: string } {
  const last = request.messages.findLastIndex((message) => message.role === "owner");
  const owner = request.messages[last];
  const after = request.messages.slice(last + 1);
  return {
    step: after.filter((message) => message.role === "agent").length,
    text: owner?.role === "owner" ? owner.text : "",
  };
}

// The helpers whose finished reports the agent has read, by their labels.
function reportsIn(request: ModelRequest): readonly string[] {
  return request.messages.flatMap((message) =>
    message.role === "owner"
      ? [...message.text.matchAll(/your helper "([^"]+)" \([^)]*\) finished/gu)].map(
          ([, label]) => label ?? "",
        )
      : [],
  );
}

/** The scripted model of a run: its answers, the reports each agent read and its calls so far. */
export interface Model {
  readonly reply: ScriptedReply;
  readonly heard: Set<string>;
  /** How many model calls it answered, each of which the runtime records once. */
  readonly calls: () => number;
}

// A helper reads twice and reports; an agent asked to research starts four helpers, and any other
// message of the agent, a helper's report among them, gets an answer.
function researchReply(
  timeline: Timeline,
  research: { readonly heard: Set<string>; readonly reads: number },
): ReplyOf {
  const { heard } = research;
  return (signal, request) => {
    const { step, text } = placeOf(request);
    if (!asks(request)) {
      const report = text.replace("Research", "Report on");
      return paced(
        timeline,
        signal,
        step < 2 ? calls(readsOf(research.reads)) : answer(report, 20),
      );
    }
    reportsIn(request).forEach((label) => heard.add(label));
    const agent = /^Research four tokens for (agent \d)$/u.exec(text)?.[1];
    if (agent === undefined || step > 0) {
      return paced(timeline, signal, answer("Here is what I found.", 75));
    }
    const helpers = [1, 2, 3, 4].map((token) => ({
      name: "helper_start",
      args: {
        task: `Research token ${String(token)} for ${agent}.`,
        label: `${agent} token ${String(token)}`,
      },
    }));
    return paced(timeline, signal, calls(helpers));
  };
}

/**
 * A model whose agents each start four helpers when asked to research, at a fast model's pace;
 * each helper makes `reads` reads at once in each of its two tool rounds.
 */
export function researchModel(reads: number): (timeline: Timeline) => Model {
  return (timeline) => {
    const heard = new Set<string>();
    const reply = researchReply(timeline, { heard, reads });
    const state = { calls: 0 };
    return {
      reply: (signal, request) => {
        state.calls += 1;
        return reply(signal, request);
      },
      heard,
      calls: () => state.calls,
    };
  };
}

// A piece of text a minute, so the model never goes quiet for its 2 minutes, and never ends.
const pieceEveryMs = 60_000;

async function* endless(timeline: Timeline, signal: AbortSignal): AsyncGenerator<ModelEvent> {
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the pieces come one after another
    await timeline.wait(pieceEveryMs, signal);
    yield { type: "text", delta: "." };
  }
}

/** A model that writes a piece now and then and never finishes its answer. */
export function endlessModel(timeline: Timeline): Model {
  const state = { calls: 0 };
  return {
    reply: (signal) => {
      state.calls += 1;
      return endless(timeline, signal);
    },
    heard: new Set(),
    calls: () => state.calls,
  };
}
