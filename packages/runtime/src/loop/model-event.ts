/**
 * Why a model response ended: `end` when the model finished its answer, `tool_calls` when it
 * waits for the results of its calls, `length` when it reached its output limit.
 */
export type ModelStop = "end" | "tool_calls" | "length";

/** The failure classes of a model call (runtime spec, section 8.2). */
export type ModelFailure =
  | "transient"
  | "context"
  | "auth"
  | "billing"
  | "request"
  | "refused"
  | "aborted";

/** The tokens one model call used, and its cost when the provider reports one. */
export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly usdMicros?: bigint;
}

/** A piece of the answer's text. */
interface TextEvent {
  readonly type: "text";
  readonly delta: string;
}

/** A piece of the model's reasoning, which stays in the transcript and reaches no surface. */
interface ReasoningEvent {
  readonly type: "reasoning";
  readonly delta: string;
}

/** A tool call begins at `index` of the response. */
interface ToolCallStartEvent {
  readonly type: "toolCallStart";
  readonly index: number;
  readonly id: string;
  readonly name: string;
}

/** A piece of the arguments' JSON text of the call at `index`. */
interface ToolCallDeltaEvent {
  readonly type: "toolCallDelta";
  readonly index: number;
  readonly delta: string;
}

/** The call at `index` is complete. */
interface ToolCallEndEvent {
  readonly type: "toolCallEnd";
  readonly index: number;
}

/** The response ended, with its stop reason and usage. */
interface DoneEvent {
  readonly type: "done";
  readonly stop: ModelStop;
  readonly usage: ModelUsage;
}

/** The call failed; the stream ends here. A transport reports a failure this way, never by throwing. */
interface ErrorEvent {
  readonly type: "error";
  readonly failure: ModelFailure;
  readonly message: string;
  /** How long the provider asked to wait before another try (`Retry-After`), when it did. */
  readonly retryAfterMs?: number;
}

/**
 * One event of a streamed model response, as a transport reduces its client's stream (runtime
 * spec, section 8.1). A stream ends with exactly one `done` or `error`.
 */
export type ModelEvent =
  | TextEvent
  | ReasoningEvent
  | ToolCallStartEvent
  | ToolCallDeltaEvent
  | ToolCallEndEvent
  | DoneEvent
  | ErrorEvent;
