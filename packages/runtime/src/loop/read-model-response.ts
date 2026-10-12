import type {
  ModelEvent,
  ModelFailure,
  ModelStop,
  ModelUsage,
  ResponseReplay,
} from "./model-event.js";
import type { ToolCall } from "./model-message.js";
import { type SettleOptions, settleBy } from "./settle-by.js";

/** A model response that ended with `done`. */
export interface ModelAnswer {
  readonly ok: true;
  readonly text: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ToolCall[];
  readonly stop: ModelStop;
  readonly usage: ModelUsage;
  readonly replay?: ResponseReplay;
}

/** A model call that failed, with what the model wrote before it did. */
export interface ModelFault {
  readonly ok: false;
  readonly failure: ModelFailure;
  readonly message: string;
  readonly text: string;
  readonly reasoning: string;
  /** The wait the provider asked for before another try. */
  readonly retryAfterMs?: number;
  /** What the provider reported the call used before it failed, when it reported anything. */
  readonly usage?: ModelUsage;
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
  // Each result names its call by id: two calls of one id would leave one without its result.
  if ([...draft.calls.values()].some((call) => call.id === event.id)) {
    return "two calls share an id";
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

function fault(
  draft: ResponseDraft,
  said: {
    readonly failure: ModelFailure;
    readonly message: string;
    readonly retryAfterMs?: number;
    readonly usage?: ModelUsage;
  },
): ModelFault {
  return {
    ok: false,
    ...said,
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
    ...(event.replay === undefined ? {} : { replay: event.replay }),
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
  if (event.type === "done") {
    return finish(draft, event);
  }
  const { failure, message, retryAfterMs, usage } = event;
  return fault(draft, {
    failure,
    message,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(usage === undefined ? {} : { usage }),
  });
}

// A stream that will not stop is closed without waiting: its next event goes nowhere.
function close(iterator: AsyncIterator<ModelEvent>): void {
  iterator.return?.().catch(() => undefined);
}

// Each event is awaited only until the signal aborts, so a transport that ignores its signal
// never holds the turn past a stop or its time limit.
async function readEvents(
  events: AsyncIterable<ModelEvent>,
  draft: ResponseDraft,
  options: SettleOptions,
): Promise<ModelResponse | string> {
  const iterator = events[Symbol.asyncIterator]();
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each event follows the one before
    const next = await settleBy(async () => iterator.next(), options);
    if (next.kind !== "value" || next.value.done === true) {
      close(iterator);
      return next.kind === "error"
        ? "the stream failed"
        : "the stream ended without its last event";
    }
    const step = apply(draft, next.value.value);
    if (step !== undefined) {
      close(iterator);
      return step;
    }
  }
}

/**
 * Reads a streamed model response into its text, reasoning and tool calls. A stream that breaks
 * its own order (a call that never started, a missing last event) is a `transient` failure, and a
 * stream that stops for the signal, or is cut by it, is `aborted`, so the loop never sees half a
 * response as whole.
 */
export async function readModelResponse(
  events: AsyncIterable<ModelEvent>,
  options: SettleOptions,
): Promise<ModelResponse> {
  const draft: ResponseDraft = { textParts: [], reasoningParts: [], calls: new Map() };
  const step = await readEvents(events, draft, options);
  if (options.signal.aborted) {
    return fault(draft, { failure: "aborted", message: "The model call was stopped." });
  }
  return typeof step === "string"
    ? fault(draft, { failure: "transient", message: `Malformed model stream: ${step}.` })
    : step;
}
