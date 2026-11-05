import { z } from "zod";
import type { ModelUsage } from "../loop/model-event.js";

// One chunk of a streamed Chat Completions answer, as the API reference documents it, read with
// the fields compatible gateways add: a reasoning text (`reasoning_details` items of type
// `reasoning.text`, else `reasoning_content`, `reasoning` or `reasoning_text`) and
// the call's cost in US dollars on the usage (`usage.cost`). Unknown fields are kept and ignored.

/** A piece of one tool call: its first piece names it, the next ones add to its arguments. */
export interface ChatToolCallPiece {
  /** Some compatible servers leave it out when a chunk holds the whole call. */
  readonly index?: number | null | undefined;
  readonly id?: string | null | undefined;
  readonly function?:
    | {
        readonly name?: string | null | undefined;
        readonly arguments?: string | null | undefined;
      }
    | null
    | undefined;
}

/** One item of a gateway's structured reasoning; only `reasoning.text` items carry readable text. */
interface ChatReasoningDetail {
  readonly type?: string | null | undefined;
  readonly text?: string | null | undefined;
}

/** What one chunk adds to the answer. */
export interface ChatDelta {
  readonly content?: string | null | undefined;
  readonly refusal?: string | null | undefined;
  readonly reasoning?: string | null | undefined;
  readonly reasoning_content?: string | null | undefined;
  readonly reasoning_text?: string | null | undefined;
  readonly reasoning_details?: readonly ChatReasoningDetail[] | null | undefined;
  readonly tool_calls?: readonly ChatToolCallPiece[] | null | undefined;
}

/** One choice of a chunk; binference asks for one, at index 0. */
interface ChatChoice {
  readonly index: number;
  readonly delta?: ChatDelta | null | undefined;
  readonly finish_reason?: string | null | undefined;
}

/** The usage the last chunk carries. */
interface ChatUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly prompt_tokens_details?:
    | { readonly cached_tokens?: number | null | undefined }
    | null
    | undefined;
  readonly cost?: number | null | undefined;
}

/** One streamed chunk. */
export interface ChatChunk {
  readonly id?: string | undefined;
  readonly choices?: readonly ChatChoice[] | undefined;
  readonly usage?: ChatUsage | null | undefined;
}

const count = z.int().nonnegative();
const text = z.string().nullish();

const toolCallPieceSchema = z.looseObject({
  index: count.nullish(),
  id: z.string().min(1).max(256).nullish(),
  function: z.looseObject({ name: text, arguments: text }).nullish(),
});

const reasoningDetailSchema = z.looseObject({ type: text, text });

const deltaSchema = z.looseObject({
  content: text,
  refusal: text,
  reasoning: text,
  reasoning_content: text,
  reasoning_text: text,
  // An item of another shape is dropped, so a gateway's new kind never breaks the stream.
  reasoning_details: z
    .array(z.unknown())
    .transform((items) =>
      items.flatMap((item) => {
        const detail = reasoningDetailSchema.safeParse(item);
        return detail.success ? [detail.data] : [];
      }),
    )
    .nullish(),
  tool_calls: z.array(toolCallPieceSchema).nullish(),
});

const usageSchema = z.looseObject({
  prompt_tokens: count,
  completion_tokens: count,
  prompt_tokens_details: z.looseObject({ cached_tokens: count.nullish() }).nullish(),
  cost: z.number().nonnegative().nullish(),
});

/** Reads one chunk of a streamed Chat Completions answer. */
export const chatChunkSchema: z.ZodType<ChatChunk> = z.looseObject({
  id: z.string().optional(),
  choices: z
    .array(z.looseObject({ index: count, delta: deltaSchema.nullish(), finish_reason: text }))
    .optional(),
  usage: usageSchema.nullish(),
});

const picosPerMicro = 1_000_000n;

// Dollars as micro-dollars, rounded up: the budget never counts less than the provider charged.
// The cost is read to the pico-dollar first, which holds a binary fraction such as 0.1 exactly.
function usdMicrosOf(usd: number): bigint {
  const picos = BigInt(Math.round(usd * 1e12));
  return (picos + picosPerMicro - 1n) / picosPerMicro;
}

/** A chunk's usage as the turn loop counts it; the provider's own cost when it reports one. */
export function modelUsageOf(usage: ChatUsage): ModelUsage {
  const counts = {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
  };
  return typeof usage.cost === "number"
    ? { ...counts, usdMicros: usdMicrosOf(usage.cost) }
    : counts;
}

/** The usage of a stream that never reported one. */
export const noUsage: ModelUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
