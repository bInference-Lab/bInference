import { jsonValueSchema } from "@binference/core";
import { z } from "zod";
import type { ModelUsage } from "../loop/model-event.js";

// The events of a streamed Messages answer, as Anthropic's streaming docs describe them:
// `message_start`, then for each content block `content_block_start`, its deltas and
// `content_block_stop`, then `message_delta` with the stop reason and `message_stop`. The client
// drops `ping`s and throws on `error`. Unknown fields, block types and delta types are kept and
// ignored, as those docs ask of new ones.

/** The token counts of `message_start`'s message, or `message_delta`'s running totals. */
export interface MessagesUsage {
  readonly input_tokens?: number | null | undefined;
  readonly output_tokens?: number | null | undefined;
  readonly cache_creation_input_tokens?: number | null | undefined;
  readonly cache_read_input_tokens?: number | null | undefined;
}

/** The block a `content_block_start` opens; fields of the types the transport reads. */
export interface MessagesBlockStart {
  readonly type: string;
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  /**
   * A tool call's whole input as JSON text, when a server sent it with the block's start instead
   * of in pieces; the documented start holds `{}`, which counts as none.
   */
  readonly inputText?: string | undefined;
  readonly signature?: string | undefined;
  readonly data?: string | undefined;
}

/** A piece a `content_block_delta` adds to its block. */
export interface MessagesDelta {
  readonly type: string;
  readonly text?: string | undefined;
  readonly thinking?: string | undefined;
  readonly signature?: string | undefined;
  readonly partial_json?: string | undefined;
}

/** One event of the stream, as the transport reads it. */
export type MessagesEvent =
  | { readonly type: "message_start"; readonly usage: MessagesUsage }
  | {
      readonly type: "content_block_start";
      readonly index: number;
      readonly block: MessagesBlockStart;
    }
  | { readonly type: "content_block_delta"; readonly index: number; readonly delta: MessagesDelta }
  | { readonly type: "content_block_stop"; readonly index: number }
  | {
      readonly type: "message_delta";
      readonly stopReason: string | undefined;
      readonly refusal: string | undefined;
      readonly usage: MessagesUsage;
    }
  | { readonly type: "message_stop" }
  | { readonly type: "other" };

const count = z.int().nonnegative();
const index = count;
const usageSchema = z.looseObject({
  input_tokens: count.nullish(),
  output_tokens: count.nullish(),
  cache_creation_input_tokens: count.nullish(),
  cache_read_input_tokens: count.nullish(),
});

const startSchema = z.looseObject({
  type: z.literal("message_start"),
  message: z.looseObject({ usage: usageSchema.nullish() }),
});

const blockStartSchema = z.looseObject({
  type: z.literal("content_block_start"),
  index,
  content_block: z.looseObject({
    type: z.string(),
    id: z.string().min(1).max(256).optional(),
    name: z.string().optional(),
    input: jsonValueSchema.optional(),
    signature: z.string().optional(),
    data: z.string().optional(),
  }),
});

const blockDeltaSchema = z.looseObject({
  type: z.literal("content_block_delta"),
  index,
  delta: z.looseObject({
    type: z.string(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    signature: z.string().optional(),
    partial_json: z.string().optional(),
  }),
});

const blockStopSchema = z.looseObject({ type: z.literal("content_block_stop"), index });

const messageDeltaSchema = z.looseObject({
  type: z.literal("message_delta"),
  delta: z.looseObject({
    stop_reason: z.string().nullish(),
    stop_details: z.looseObject({ category: z.string().nullish() }).nullish(),
  }),
  usage: usageSchema.nullish(),
});

const stopSchema = z.looseObject({ type: z.literal("message_stop") });

const typedSchema = z.looseObject({ type: z.string() });

// Each known event read with its own schema; one of the wrong shape is no event at all.
function readAs<T extends z.ZodType>(
  schema: T,
  raw: unknown,
  map: (event: z.infer<T>) => MessagesEvent,
): MessagesEvent | undefined {
  const parsed = schema.safeParse(raw);
  return parsed.success ? map(parsed.data) : undefined;
}

const readers = new Map<string, (raw: unknown) => MessagesEvent | undefined>(
  Object.entries({
    message_start: (raw: unknown) =>
      readAs(startSchema, raw, (event) => ({
        type: "message_start",
        usage: event.message.usage ?? {},
      })),
    content_block_start: (raw: unknown) =>
      readAs(blockStartSchema, raw, (event) => {
        const { input, ...block } = event.content_block;
        const isWhole =
          typeof input === "object" && input !== null && Object.keys(input).length > 0;
        return {
          type: "content_block_start",
          index: event.index,
          block: isWhole ? { ...block, inputText: JSON.stringify(input) } : block,
        };
      }),
    content_block_delta: (raw: unknown) =>
      readAs(blockDeltaSchema, raw, (event) => ({
        type: "content_block_delta",
        index: event.index,
        delta: event.delta,
      })),
    content_block_stop: (raw: unknown) =>
      readAs(blockStopSchema, raw, (event) => ({ type: "content_block_stop", index: event.index })),
    message_delta: (raw: unknown) =>
      readAs(messageDeltaSchema, raw, (event) => ({
        type: "message_delta",
        stopReason: event.delta.stop_reason ?? undefined,
        refusal: event.delta.stop_details?.category ?? undefined,
        usage: event.usage ?? {},
      })),
    message_stop: (raw: unknown) => readAs(stopSchema, raw, () => ({ type: "message_stop" })),
  }),
);

/**
 * Reads one streamed event into what the transport needs of it. An event it does not know is
 * `other`; a value that is not an event at all, or a known event of the wrong shape, is
 * `undefined`.
 */
export function messagesEventOf(raw: unknown): MessagesEvent | undefined {
  const typed = typedSchema.safeParse(raw);
  if (!typed.success) {
    return undefined;
  }
  const reader = readers.get(typed.data.type);
  return reader === undefined ? { type: "other" } : reader(raw);
}

/**
 * A Messages answer's usage as the turn loop counts it: the input in all, cached or not
 * (`input_tokens` holds only what follows the last cache mark), the tokens read from the cache,
 * and the output. Later counts replace earlier ones, since `message_delta` carries running totals.
 */
export function messagesUsageOf(counts: MessagesUsage): ModelUsage {
  const created = counts.cache_creation_input_tokens ?? 0;
  const read = counts.cache_read_input_tokens ?? 0;
  return {
    inputTokens: (counts.input_tokens ?? 0) + created + read,
    outputTokens: counts.output_tokens ?? 0,
    cachedTokens: read,
  };
}

/** Running totals, each count of the later usage replacing the earlier one when it is given. */
export function laterUsage(earlier: MessagesUsage, later: MessagesUsage): MessagesUsage {
  return {
    input_tokens: later.input_tokens ?? earlier.input_tokens,
    output_tokens: later.output_tokens ?? earlier.output_tokens,
    cache_creation_input_tokens:
      later.cache_creation_input_tokens ?? earlier.cache_creation_input_tokens,
    cache_read_input_tokens: later.cache_read_input_tokens ?? earlier.cache_read_input_tokens,
  };
}
