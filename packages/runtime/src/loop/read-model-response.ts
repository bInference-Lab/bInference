import type { ModelEvent, ModelFailure, ModelStop, ModelUsage } from "./model-event.js";
import type { ToolCall } from "./model-message.js";

/** A model response that ended with `done`. */
export interface ModelAnswer {
  readonly ok: true;
  readonly text: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ToolCall[];
  readonly stop: ModelStop;
  readonly usage: ModelUsage;
}

/** A model call that failed, with what the model wrote before it did. */
export interface ModelFault {
  readonly ok: false;
  readonly failure: ModelFailure;
  readonly message: string;
  readonly text: string;
  readonly reasoning: string;
}

/** A model call's outcome. */
export type ModelResponse = ModelAnswer | ModelFault;

interface CallDraft {
  readonly id: string;
  readonly name: string;
  readonly argumentParts: string[];
  ended: boolean;
}

interface ResponseDraft {
  readonly textParts: string[];
  readonly reasoningParts: string[];
  readonly calls: Map<number, CallDraft>;
}

type Step = ModelResponse | string | undefined;

function startCall(draft: ResponseDraft, event: Extract<ModelEvent, { type: "toolCallStart" }>) {
  if (draft.calls.has(event.index)) {
    return `call ${String(event.index)} started twice`;
  }
  draft.calls.set(event.index, { id: event.id, name: event.name, argumentParts: [], ended: false });
  return undefined;
}

function openCall(draft: ResponseDraft, index: number): CallDraft | string {
  const call = draft.calls.get(index);
  if (call === undefined || call.ended) {
    return `call ${String(index)} is not open`;
  }
  return call;
}

function addArguments(draft: ResponseDraft, index: number, delta: string): string | undefined {
  const call = openCall(draft, index);
  if (typeof call === "string") {
    return call;
  }
  call.argumentParts.push(delta);
  return undefined;
}

function endCall(draft: ResponseDraft, index: number): string | undefined {
  const call = openCall(draft, index);
  if (typeof call === "string") {
    return call;
  }
  call.ended = true;
  return undefined;
}

function toolCallsOf(draft: ResponseDraft): readonly ToolCall[] {
  return [...draft.calls.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([, call]) => ({
      id: call.id,
      name: call.name,
      argumentsText: call.argumentParts.join(""),
    }));
}

function fault(draft: ResponseDraft, failure: ModelFailure, message: string): ModelFault {
  return {
    ok: false,
    failure,
    message,
    text: draft.textParts.join(""),
    reasoning: draft.reasoningParts.join(""),
  };
}

// A response cut off at its output limit may leave a call open; any other must close each call.
function finish(draft: ResponseDraft, event: Extract<ModelEvent, { type: "done" }>): Step {
  const open = [...draft.calls.values()].some((call) => !call.ended);
  if (open && event.stop !== "length") {
    return "a call never ended";
  }
  return {
    ok: true,
    text: draft.textParts.join(""),
    reasoning: draft.reasoningParts.join(""),
    toolCalls: toolCallsOf(draft),
    stop: event.stop,
    usage: event.usage,
  };
}

function apply(draft: ResponseDraft, event: ModelEvent): Step {
  if (event.type === "text" || event.type === "reasoning") {
    (event.type === "text" ? draft.textParts : draft.reasoningParts).push(event.delta);
    return undefined;
  }
  if (event.type === "toolCallStart") {
    return startCall(draft, event);
  }
  if (event.type === "toolCallDelta") {
    return addArguments(draft, event.index, event.delta);
  }
  if (event.type === "toolCallEnd") {
    return endCall(draft, event.index);
  }
  return event.type === "done" ? finish(draft, event) : fault(draft, event.failure, event.message);
}

async function readEvents(
  events: AsyncIterable<ModelEvent>,
  draft: ResponseDraft,
): Promise<ModelResponse | string> {
  for await (const event of events) {
    const step = apply(draft, event);
    if (step !== undefined) {
      return step;
    }
  }
  return "the stream ended without its last event";
}

/**
 * Reads a streamed model response into its text, reasoning and tool calls. A stream that breaks
 * its own order (a call that never started, a missing last event) is a `transient` failure, and a
 * stream that stops for the signal is `aborted`, so the loop never sees half a response as whole.
 */
export async function readModelResponse(
  events: AsyncIterable<ModelEvent>,
  signal: AbortSignal,
): Promise<ModelResponse> {
  const draft: ResponseDraft = { textParts: [], reasoningParts: [], calls: new Map() };
  let step: ModelResponse | string;
  try {
    step = await readEvents(events, draft);
  } catch {
    step = "the stream failed";
  }
  if (signal.aborted) {
    return fault(draft, "aborted", "The model call was stopped.");
  }
  return typeof step === "string"
    ? fault(draft, "transient", `Malformed model stream: ${step}.`)
    : step;
}
