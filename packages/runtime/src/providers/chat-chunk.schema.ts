import { z } from "zod";
import type { ModelUsage } from "../loop/model-event.js";

// One chunk of a streamed Chat Completions answer, as the API reference documents it, read with
// the fields compatible gateways add: a reasoning text (`reasoning`, or `reasoning_content`) and
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

/** What one chunk adds to the answer. */
export interface ChatDelta {
  readonly content?: string | null | undefined;
  readonly refusal?: string | null | undefined;
  readonly reasoning?: string | null | undefined;
  readonly reasoning_content?: string | null | undefined;
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

const deltaSchema = z.looseObject({
  content: text,
  refusal: text,
  reasoning: text,
  reasoning_content: text,
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
