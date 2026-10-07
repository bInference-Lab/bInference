import { z } from "zod";

const secondMs = 1000;
const targetSchema = z.looseObject({ chat_id: z.union([z.int(), z.string()]).optional() });
const floodSchema = z.looseObject({
  ok: z.literal(false),
  error_code: z.literal(429),
  parameters: z.looseObject({ retry_after: z.number().nonnegative().optional() }).optional(),
});

const abortedSchema = z.looseObject({ reason: z.unknown() });

/**
 * Why a signal aborted. grammY types its signals with an old polyfill that has no `reason`; the
 * signals binference passes are Node's, which carry one.
 */
export function abortReasonOf(signal: unknown): unknown {
  return abortedSchema.safeParse(signal).data?.reason;
}

/** The chat a Bot API call writes to, read from its payload; `undefined` for a call to no chat. */
export function chatIdOf(payload: unknown): number | string | undefined {
  return targetSchema.safeParse(payload).data?.chat_id;
}

/**
 * How long Telegram asks the bot to wait, when an answer is a 429: its `retry_after` in
 * milliseconds, or one second when it names none. `undefined` for any other answer.
 */
export function floodWaitMsOf(answer: unknown): number | undefined {
  const flood = floodSchema.safeParse(answer);
  return flood.success ? (flood.data.parameters?.retry_after ?? 1) * secondMs : undefined;
}
