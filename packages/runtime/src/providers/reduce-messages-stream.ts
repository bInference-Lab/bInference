import type { JsonValue } from "@binference/core";
import type { ModelEvent, ModelStop, ResponseReplay } from "../loop/model-event.js";
import {
  laterUsage,
  type MessagesBlockStart,
  type MessagesDelta,
  type MessagesEvent,
  messagesEventOf,
  type MessagesUsage,
  messagesUsageOf,
} from "./messages-event.schema.js";
import { inputObjectOf } from "./messages-replay.schema.js";

/** The events one stream event gives; an error among them ends the stream. */
type Step = readonly ModelEvent[];

interface TextDraft {
  readonly kind: "text";
  readonly parts: string[];
}

interface ThinkingDraft {
  readonly kind: "thinking";
  readonly parts: string[];
  /** The signature as it came: whole with the start, or in `signature_delta` pieces. */
  readonly signature: string[];
}

interface RedactedDraft {
  readonly kind: "redacted";
  readonly data: string;
}

interface ToolDraft {
  readonly kind: "tool";
  readonly id: string;
  readonly name: string;
  readonly parts: string[];
  /** The whole input, when a server sent it with the block's start instead of in pieces. */
  readonly startInput: string | undefined;
}

/** A block the transport neither shows nor sends back, such as a new type. */
interface OtherDraft {
  readonly kind: "other";
}

type BlockDraft = TextDraft | ThinkingDraft | RedactedDraft | ToolDraft | OtherDraft;

const malformed = (what: string): ModelEvent => ({
  type: "error",
  failure: "transient",
  message: `The model provider sent a malformed stream: ${what}.`,
});

const isError = (event: ModelEvent): boolean => event.type === "error";

function draftOf(block: MessagesBlockStart): BlockDraft | string {
  if (block.type === "text") {
    return { kind: "text", parts: [] };
  }
  if (block.type === "thinking") {
    return { kind: "thinking", parts: [], signature: [block.signature ?? ""] };
  }
  if (block.type === "redacted_thinking") {
    return { kind: "redacted", data: block.data ?? "" };
  }
  if (block.type !== "tool_use") {
    return { kind: "other" };
  }
  if (block.id === undefined || block.name === undefined || block.name === "") {
    return "a tool call began without its id or name";
  }
  return {
    kind: "tool",
    id: block.id,
    name: block.name,
    parts: [],
    startInput: block.inputText,
  };
}

function textDelta(draft: TextDraft, delta: MessagesDelta): Step {
  const text = delta.type === "text_delta" ? (delta.text ?? "") : "";
  draft.parts.push(text);
  return text === "" ? [] : [{ type: "text", delta: text }];
}

function thinkingDelta(draft: ThinkingDraft, delta: MessagesDelta): Step {
  if (delta.type === "signature_delta") {
    draft.signature.push(delta.signature ?? "");
    return [];
  }
  const thinking = delta.type === "thinking_delta" ? (delta.thinking ?? "") : "";
  draft.parts.push(thinking);
  return thinking === "" ? [] : [{ type: "reasoning", delta: thinking }];
}

function inputDelta(draft: ToolDraft, index: number, delta: MessagesDelta): Step {
  const piece = delta.type === "input_json_delta" ? (delta.partial_json ?? "") : "";
  draft.parts.push(piece);
  return piece === "" ? [] : [{ type: "toolCallDelta", index, delta: piece }];
}

// A delta of a type the transport does not know, or for a block it does not read, adds nothing.
function deltaEvents(draft: BlockDraft, index: number, delta: MessagesDelta): Step {
  if (draft.kind === "text") {
    return textDelta(draft, delta);
  }
  if (draft.kind === "thinking") {
    return thinkingDelta(draft, delta);
  }
  return draft.kind === "tool" ? inputDelta(draft, index, delta) : [];
}

// A call whose input came whole with its start, and in no piece after, gets it as one piece.
function stopEvents(draft: BlockDraft, index: number): Step {
  if (draft.kind !== "tool") {
    return [];
  }
  const whole = draft.parts.join("") === "" ? draft.startInput : undefined;
  if (whole !== undefined) {
    draft.parts.push(whole);
  }
  return [
    ...(whole === undefined ? [] : [{ type: "toolCallDelta", index, delta: whole } as const]),
    { type: "toolCallEnd", index },
  ];
}

function replayBlock(draft: BlockDraft): JsonValue | undefined {
  if (draft.kind === "text") {
    const text = draft.parts.join("");
    return text === "" ? undefined : { type: "text", text };
  }
  if (draft.kind === "thinking") {
    const thinking = draft.parts.join("");
    return { type: "thinking", thinking, signature: draft.signature.join("") };
  }
  if (draft.kind === "redacted") {
    return { type: "redacted_thinking", data: draft.data };
  }
  return draft.kind === "tool"
    ? {
        type: "tool_use",
        id: draft.id,
        name: draft.name,
        input: inputObjectOf(draft.parts.join("")),
      }
    : undefined;
}

// A response that thought goes back as its blocks came, its thinking with its signatures (the API
// refuses a later call without them); one that did not is written again from its text and calls.
function replayOf(blocks: ReadonlyMap<number, BlockDraft>): ResponseReplay | undefined {
  const drafts = [...blocks.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([, draft]) => draft);
  if (!drafts.some((draft) => draft.kind === "thinking" || draft.kind === "redacted")) {
    return undefined;
  }
  const content = drafts.flatMap((draft) => replayBlock(draft) ?? []);
  return { format: "messages", content };
}

// The stop reasons Anthropic documents: `max_tokens` and a context window filled by the
// answer cut it; a response with calls waits for their results whatever else it says.
function stopOf(reason: string, blocks: ReadonlyMap<number, BlockDraft>): ModelStop {
  if (reason === "max_tokens" || reason === "model_context_window_exceeded") {
    return "length";
  }
  return [...blocks.values()].some((draft) => draft.kind === "tool") ? "tool_calls" : "end";
}

/** What the stream said by its end. */
interface StreamEnd {
  readonly blocks: ReadonlyMap<number, BlockDraft>;
  readonly stopReason: string | undefined;
  readonly refusal: string | undefined;
  readonly usage: MessagesUsage;
}

function endEvents(end: StreamEnd): Step {
  if (end.stopReason === undefined) {
    return [malformed("it ended before the model finished")];
  }
  if (end.stopReason === "refusal") {
    const named = end.refusal !== undefined && /^[\w.-]{1,64}$/.test(end.refusal);
    const category = named ? ` (${end.refusal ?? ""})` : "";
    const message = `The provider stopped the answer for its safety rules${category}.`;
    return [{ type: "error", failure: "refused", message }];
  }
  const replay = replayOf(end.blocks);
  return [
    {
      type: "done",
      stop: stopOf(end.stopReason, end.blocks),
      usage: messagesUsageOf(end.usage),
      ...(replay === undefined ? {} : { replay }),
    },
  ];
}

// A block's start: a call starts at the block's index; a second start of one index is malformed.
function startedEvents(
  blocks: Map<number, BlockDraft>,
  index: number,
  block: MessagesBlockStart,
): Step {
  if (blocks.has(index)) {
    return [malformed(`block ${String(index)} started twice`)];
  }
  const draft = draftOf(block);
  if (typeof draft === "string") {
    return [malformed(draft)];
  }
  blocks.set(index, draft);
  return draft.kind === "tool"
    ? [{ type: "toolCallStart", index, id: draft.id, name: draft.name }]
    : [];
}

/** Reads a stream's events in order, keeping what it said so far. */
function createEventReader() {
  const blocks = new Map<number, BlockDraft>();
  const said: {
    stopReason: string | undefined;
    refusal: string | undefined;
    usage: MessagesUsage;
  } = { stopReason: undefined, refusal: undefined, usage: {} };

  function inBlock(index: number, then: (draft: BlockDraft) => Step): Step {
    const draft = blocks.get(index);
    return draft === undefined ? [malformed(`block ${String(index)} never started`)] : then(draft);
  }

  return {
    read(event: MessagesEvent): Step {
      if (event.type === "content_block_start") {
        return startedEvents(blocks, event.index, event.block);
      }
      if (event.type === "content_block_delta") {
        return inBlock(event.index, (draft) => deltaEvents(draft, event.index, event.delta));
      }
      if (event.type === "content_block_stop") {
        return inBlock(event.index, (draft) => stopEvents(draft, event.index));
      }
      if (event.type === "message_start" || event.type === "message_delta") {
        said.usage = laterUsage(said.usage, event.usage);
      }
      if (event.type === "message_delta") {
        said.stopReason = event.stopReason ?? said.stopReason;
        said.refusal = event.refusal ?? said.refusal;
      }
      return [];
    },
    end: (): StreamEnd => ({
      blocks,
      stopReason: said.stopReason,
      refusal: said.refusal,
      usage: said.usage,
    }),
  };
}

/**
 * Reduces a streamed Messages answer into the turn loop's events (runtime spec, section 8.1):
 * text, reasoning, each tool call's start, input pieces and end, then `done` with the stop
 * reason, the usage and, when the model thought, the replay its later calls send back. An event
 * it cannot read ends the stream as a `transient` error; a `refusal` ends it as `refused`. A stream
 * that ends with no stop reason ends `aborted` when the signal did, else `transient`. Faults the
 * client throws, an error event among them, are left to the caller.
 */
export async function* reduceMessagesStream(
  events: AsyncIterable<object>,
  signal: AbortSignal,
): AsyncGenerator<ModelEvent, void, undefined> {
  const reader = createEventReader();
  for await (const raw of events) {
    const event = messagesEventOf(raw);
    const step = event === undefined ? [malformed("an event")] : reader.read(event);
    yield* step;
    if (step.some(isError)) {
      return;
    }
  }
  if (signal.aborted) {
    yield { type: "error", failure: "aborted", message: "The model call was stopped." };
    return;
  }
  yield* endEvents(reader.end());
}
