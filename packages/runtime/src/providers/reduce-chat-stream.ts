import type { ModelEvent, ModelStop, ModelUsage } from "../loop/model-event.js";
import {
  type ChatChunk,
  chatChunkSchema,
  type ChatDelta,
  type ChatToolCallPiece,
  modelUsageOf,
  noUsage,
} from "./chat-chunk.schema.js";

/** The events one chunk gives; an error among them ends the stream. */
type Step = readonly ModelEvent[];

/** What the stream said by its end: its calls by index, its stop reason and its usage. */
interface StreamEnd {
  readonly calls: ReadonlySet<number>;
  readonly finish: string | undefined;
  readonly usage: ModelUsage | undefined;
}

const malformed = (what: string): ModelEvent => ({
  type: "error",
  failure: "transient",
  message: `The model provider sent a malformed stream: ${what}.`,
});

const isError = (event: ModelEvent): boolean => event.type === "error";

// A piece names its call by index; a compatible server that leaves the index out sends a new
// call with its id, and more of the latest call without one.
function indexOf(
  piece: ChatToolCallPiece,
  calls: { readonly started: ReadonlySet<number>; readonly latest: number | undefined },
): number | undefined {
  if (typeof piece.index === "number") {
    return piece.index;
  }
  return typeof piece.id === "string" ? calls.started.size : calls.latest;
}

// The start of a call, from its first piece. A server that gives no id gets one from the answer's
// id and the call's place.
function startOf(piece: ChatToolCallPiece, index: number, answerId: string): ModelEvent {
  const name = piece.function?.name;
  if (typeof name !== "string" || name === "") {
    return malformed("a tool call began without a name");
  }
  const id = piece.id ?? `${answerId}_${String(index)}`;
  return { type: "toolCallStart", index, id, name };
}

function textEvents(delta: ChatDelta): ModelEvent[] {
  const reasoning = delta.reasoning ?? delta.reasoning_content ?? "";
  // A model's own refusal is its answer, which the owner reads like any text.
  const said = `${delta.content ?? ""}${delta.refusal ?? ""}`;
  return [
    ...(reasoning === "" ? [] : [{ type: "reasoning", delta: reasoning } as const]),
    ...(said === "" ? [] : [{ type: "text", delta: said } as const]),
  ];
}

// Chat Completions' stop reasons as the loop's: a response with calls waits for their results
// whatever reason it gave, unless its output limit cut it.
function stopOf(finish: string, end: StreamEnd): ModelStop {
  if (finish === "length") {
    return "length";
  }
  return end.calls.size > 0 ? "tool_calls" : "end";
}

/** The events that end a stream that ran to its end without a fault. */
function endEvents(end: StreamEnd): Step {
  const { finish } = end;
  if (finish === undefined) {
    return [malformed("it ended before the model finished")];
  }
  // An answer the provider ended itself was still billed: its usage goes with the failure.
  const billed = end.usage === undefined ? {} : { usage: end.usage };
  if (finish === "content_filter") {
    const message = "The provider's content filter stopped the answer.";
    return [{ type: "error", failure: "refused", message, ...billed }];
  }
  if (finish === "error") {
    const message = "The model provider ended the answer with an error.";
    return [{ type: "error", failure: "transient", message, ...billed }];
  }
  const ends = [...end.calls].toSorted((left, right) => left - right);
  return [
    ...ends.map((index): ModelEvent => ({ type: "toolCallEnd", index })),
    { type: "done", stop: stopOf(finish, end), usage: end.usage ?? noUsage },
  ];
}

function usageIn(chunk: ChatChunk): ModelUsage | undefined {
  return chunk.usage === null || chunk.usage === undefined ? undefined : modelUsageOf(chunk.usage);
}

/** Reads a stream's chunks in order, keeping what it said so far. */
function createChunkReader() {
  const started = new Set<number>();
  let latest: number | undefined;
  let finish: string | undefined;
  let usage: ModelUsage | undefined;

  function pieceEvents(piece: ChatToolCallPiece, answerId: string): Step {
    const index = indexOf(piece, { started, latest });
    if (index === undefined) {
      return [malformed("a tool call piece names no call")];
    }
    const start = started.has(index) ? [] : [startOf(piece, index, answerId)];
    if (start.some(isError)) {
      return start;
    }
    started.add(index);
    latest = index;
    const delta = piece.function?.arguments ?? "";
    return delta === "" ? start : [...start, { type: "toolCallDelta", index, delta }];
  }

  function deltaEvents(delta: ChatDelta, answerId: string): Step {
    const events = textEvents(delta);
    for (const piece of delta.tool_calls ?? []) {
      const step = pieceEvents(piece, answerId);
      events.push(...step);
      if (step.some(isError)) {
        return events;
      }
    }
    return events;
  }

  return {
    read(chunk: ChatChunk): Step {
      usage = usageIn(chunk) ?? usage;
      // binference asks for one choice; any other is ignored.
      const choice = chunk.choices?.find((item) => item.index === 0);
      finish ??= choice?.finish_reason ?? undefined;
      const delta = choice?.delta;
      return delta === null || delta === undefined ? [] : deltaEvents(delta, chunk.id ?? "call");
    },
    end: (): StreamEnd => ({ calls: started, finish, usage }),
  };
}

/**
 * Reduces a streamed Chat Completions answer into the turn loop's events (runtime spec, section
 * 8.1): reasoning, text, each tool call's start and argument pieces, then each call's end and
 * `done` with the stop reason and the usage of the last chunk. A chunk it cannot read ends the
 * stream as a `transient` error; `content_filter` ends it as `refused`. A stream that ends with
 * no stop reason ends `aborted` when the signal did, else `transient`. Faults the client throws
 * are left to the caller.
 */
export async function* reduceChatStream(
  chunks: AsyncIterable<object>,
  signal: AbortSignal,
): AsyncGenerator<ModelEvent, void, undefined> {
  const reader = createChunkReader();
  for await (const raw of chunks) {
    const chunk = chatChunkSchema.safeParse(raw);
    const events = chunk.success ? reader.read(chunk.data) : [malformed("a chunk")];
    yield* events;
    if (events.some(isError)) {
      return;
    }
  }
  if (signal.aborted) {
    yield { type: "error", failure: "aborted", message: "The model call was stopped." };
    return;
  }
  yield* endEvents(reader.end());
}
