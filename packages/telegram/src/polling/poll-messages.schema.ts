import {
  BinferenceError,
  type ErrorCode,
  isErrorCode,
  type JsonValue,
  jsonValueSchema,
  valueNestsDeeperThan,
} from "@binference/core";
import { z } from "zod";

/** One update from `getUpdates`, with its id read out for the next offset. */
export interface PolledUpdate {
  readonly updateId: number;
  /** The update as the Bot API sent it. */
  readonly update: JsonValue;
}

/** What a poll worker starts with. */
export interface PollSetup {
  readonly token: string;
  readonly apiRoot?: string;
}

/** The parent's request to a poll worker: fetch after an offset, or cancel a fetch. */
export type PollRequest =
  | { readonly kind: "fetch"; readonly id: number; readonly offset?: number }
  | { readonly kind: "cancel"; readonly id: number };

/** A fault as it crosses from the worker to the parent: its code and whether to retry. */
export interface PollFault {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

/** A poll worker's answer to one fetch. */
export type PollReply =
  | { readonly kind: "updates"; readonly id: number; readonly updates: readonly PolledUpdate[] }
  | { readonly kind: "fault"; readonly id: number; readonly fault: PollFault };

const requestId = z.int().positive();
const updateIdSchema = z.int().nonnegative();

const polledUpdateSchema: z.ZodType<PolledUpdate> = z.strictObject({
  updateId: updateIdSchema,
  update: jsonValueSchema,
});

const pollSetupSchema: z.ZodType<PollSetup> = z.strictObject({
  token: z.string().min(1),
  apiRoot: z.url().exactOptional(),
});

const pollRequestSchema: z.ZodType<PollRequest> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fetch"),
    id: requestId,
    offset: updateIdSchema.exactOptional(),
  }),
  z.strictObject({ kind: z.literal("cancel"), id: requestId }),
]);

const pollFaultSchema: z.ZodType<PollFault> = z.strictObject({
  code: z.string().refine(isErrorCode),
  retryable: z.boolean(),
  retryAfterMs: z.int().nonnegative().exactOptional(),
});

const pollReplySchema: z.ZodType<PollReply> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("updates"),
    id: requestId,
    updates: z.array(polledUpdateSchema),
  }),
  z.strictObject({ kind: z.literal("fault"), id: requestId, fault: pollFaultSchema }),
]);

const answerSchema = z.array(jsonValueSchema);
// Each update's id alone: the rest of an update is not read here.
const headsSchema = z.array(z.looseObject({ update_id: updateIdSchema }));

/**
 * Reads a `getUpdates` answer. Throws a retryable `telegram.bad_answer` when it is not a list of
 * updates, each with a whole `update_id`. An update nested past `maxJsonDepth` goes on as its id
 * alone, read before anything walks it (decision 0417), so its offset still acknowledges it.
 */
export function polledBatchOf(answer: unknown): readonly PolledUpdate[] {
  const heads = headsSchema.safeParse(answer);
  const kept = heads.success
    ? heads.data.map((head) => (valueNestsDeeperThan(head) ? { update_id: head.update_id } : head))
    : undefined;
  const updates = answerSchema.safeParse(kept);
  if (!updates.success || !heads.success) {
    throw new BinferenceError({
      code: "telegram.bad_answer",
      message: "getUpdates answered something other than a list of updates.",
      retryable: true,
    });
  }
  return heads.data.map((head, index) => ({
    updateId: head.update_id,
    update: updates.data[index] ?? null,
  }));
}

/** Reads a poll worker's setup; throws when it is not one. */
export function pollSetupOf(value: unknown): PollSetup {
  return pollSetupSchema.parse(value);
}

/** Reads a message to a poll worker; `undefined` when it is not a request. */
export function pollRequestOf(value: unknown): PollRequest | undefined {
  const parsed = pollRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Reads a poll worker's message; `undefined` when it is not a reply. */
export function pollReplyOf(value: unknown): PollReply | undefined {
  const parsed = pollReplySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The fault a worker sends for a failed fetch: a `BinferenceError`'s code, or `poller_failed`. */
export function pollFaultOf(error: unknown): PollFault {
  if (!(error instanceof BinferenceError)) {
    return { code: "telegram.poller_failed", retryable: false };
  }
  const retryAfterMs = error.details["retryAfterMs"];
  return {
    code: error.code,
    retryable: error.retryable,
    ...(typeof retryAfterMs === "number" ? { retryAfterMs } : {}),
  };
}
