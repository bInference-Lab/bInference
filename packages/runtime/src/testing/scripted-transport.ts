import type { JsonValue } from "@binference/core";
import type { ModelEvent } from "../loop/model-event.js";
import type { ModelTransport } from "../loop/ports.js";
import type { ModelRequest } from "../loop/turn-records.js";

/**
 * One scripted model response: its events, or a stream the test drives itself, such as one that
 * waits for the test before it ends.
 */
export type ScriptedReply =
  | readonly ModelEvent[]
  | ((signal: AbortSignal, request: ModelRequest) => AsyncIterable<ModelEvent>);

/** A transport that answers each model call with the next scripted response. */
export interface ScriptedTransport extends ModelTransport {
  /** Each request the loop sent, in order, as it was sent. */
  readonly requests: readonly ModelRequest[];
}

/** A call a scripted response makes; its arguments are JSON text, or a value written as JSON. */
export interface ScriptedCall {
  readonly id?: string;
  readonly name: string;
  readonly args?: string | JsonValue;
}

const usage = { inputTokens: 10, outputTokens: 5, cachedTokens: 0 };

/** A response that answers with text and no tool call. */
export function textReply(text: string): readonly ModelEvent[] {
  return [
    { type: "text", delta: text },
    { type: "done", stop: "end", usage },
  ];
}

/** A response with tool calls; each call's id defaults to its name. */
export function callsReply(calls: readonly ScriptedCall[], text = ""): readonly ModelEvent[] {
  const callEvents = calls.flatMap((call, index): ModelEvent[] => [
    { type: "toolCallStart", index, id: call.id ?? call.name, name: call.name },
    {
      type: "toolCallDelta",
      index,
      delta: typeof call.args === "string" ? call.args : JSON.stringify(call.args ?? {}),
    },
    { type: "toolCallEnd", index },
  ]);
  const said: ModelEvent[] = text === "" ? [] : [{ type: "text", delta: text }];
  return [...said, ...callEvents, { type: "done", stop: "tool_calls", usage }];
}

async function* play(
  events: readonly ModelEvent[],
  signal: AbortSignal,
): AsyncGenerator<ModelEvent> {
  for (const event of events) {
    if (signal.aborted) {
      yield { type: "error", failure: "aborted", message: "Stopped." } satisfies ModelEvent;
      return;
    }
    yield event;
  }
}

const exhausted: readonly ModelEvent[] = [
  { type: "error", failure: "request", message: "The script has no response left." },
];

/** Creates a transport that answers model calls from a script, in order, and keeps each request. */
export function createScriptedTransport(replies: readonly ScriptedReply[]): ScriptedTransport {
  const requests: ModelRequest[] = [];
  return {
    requests,
    stream(request, signal) {
      const reply = replies[requests.length] ?? exhausted;
      requests.push({ ...request, messages: [...request.messages] });
      return typeof reply === "function" ? reply(signal, request) : play(reply, signal);
    },
  };
}
