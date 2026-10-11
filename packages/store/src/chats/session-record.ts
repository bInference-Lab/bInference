import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { fenceSchema, type Fenced } from "./fenced.js";

/** One conversation between the owner and an agent, under the id the engine gave it. */
export interface SessionRecord {
  readonly id: Id<"ses">;
  readonly agentId: Id<"agt">;
  /** The surface the session began on, such as `telegram`. */
  readonly surface: string;
  /** Where on that surface, such as `telegram:<chat>:<topic>`. */
  readonly conversation: string;
  readonly startedAtMs: number;
  /** When `chat/clear` closed it. */
  readonly clearedAtMs?: number;
  /** The latest summary compaction wrote. */
  readonly summary?: string;
  readonly version: number;
}

/** A session as it opens. */
export type SessionDraft = Pick<
  SessionRecord,
  "id" | "agentId" | "surface" | "conversation" | "startedAtMs"
>;

/** Closes a session at the version its closer read. */
export interface SessionClose {
  readonly session: Id<"ses">;
  readonly atMs: number;
  readonly version: number;
}

const epochMs = z.int().nonnegative();
const nameSchema = z.string().min(1).max(200);

/** Parses a session record. */
export const sessionRecordSchema: z.ZodType<SessionRecord> = z.strictObject({
  id: idSchema("ses"),
  agentId: idSchema("agt"),
  surface: z.string().min(1).max(32),
  conversation: nameSchema,
  startedAtMs: epochMs,
  clearedAtMs: epochMs.exactOptional(),
  summary: z.string().max(16_000).exactOptional(),
  version: z.int().nonnegative(),
});

/** Parses a fenced session draft. */
export const sessionDraftSchema: z.ZodType<Fenced<SessionDraft>> = z.strictObject({
  id: idSchema("ses"),
  agentId: idSchema("agt"),
  surface: z.string().min(1).max(32),
  conversation: nameSchema,
  startedAtMs: epochMs,
  fence: fenceSchema,
});

/** Parses a fenced session close. */
export const sessionCloseSchema: z.ZodType<Fenced<SessionClose>> = z.strictObject({
  session: idSchema("ses"),
  atMs: epochMs,
  version: z.int().nonnegative(),
  fence: fenceSchema,
});
