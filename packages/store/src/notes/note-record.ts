import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { fenceSchema, type Fenced } from "../chats/fenced.js";

/** Who a note comes from (ARCHITECTURE.md section 5); `untrusted` came from outside content. */
export type NoteOrigin = "owner" | "agent" | "untrusted" | "system";

/** One note an agent keeps. */
export interface NoteRecord {
  readonly id: number;
  readonly agentId: Id<"agt">;
  readonly text: string;
  readonly origin: NoteOrigin;
  readonly createdAtMs: number;
  readonly changedAtMs: number;
  readonly deletedAtMs?: number;
}

/** A note as it is written. */
export interface NoteDraft {
  readonly agentId: Id<"agt">;
  readonly text: string;
  readonly origin: NoteOrigin;
  readonly atMs: number;
}

/** A note's removal. */
export interface NoteDelete {
  readonly note: number;
  readonly atMs: number;
}

/** An agent's notes after `afterId`, oldest first, at most `limit`. */
export interface NoteList {
  readonly agentId: Id<"agt">;
  readonly afterId?: number;
  readonly limit: number;
}

/** An agent's notes whose text holds the query, at most `limit`. */
export interface NoteSearch {
  readonly agentId: Id<"agt">;
  readonly query: string;
  readonly limit: number;
}

const epochMs = z.int().nonnegative();
const originSchema = z.enum(["owner", "agent", "untrusted", "system"]);
const textSchema = z.string().min(1).max(12_000);
const limitSchema = z.int().min(1).max(200);

/** Parses a note. */
export const noteRecordSchema: z.ZodType<NoteRecord> = z.strictObject({
  id: z.int().positive(),
  agentId: idSchema("agt"),
  text: textSchema,
  origin: originSchema,
  createdAtMs: epochMs,
  changedAtMs: epochMs,
  deletedAtMs: epochMs.exactOptional(),
});

/** Parses a fenced note draft. */
export const noteDraftSchema: z.ZodType<Fenced<NoteDraft>> = z.strictObject({
  agentId: idSchema("agt"),
  text: textSchema,
  origin: originSchema,
  atMs: epochMs,
  fence: fenceSchema,
});

/** Parses a fenced note removal. */
export const noteDeleteSchema: z.ZodType<Fenced<NoteDelete>> = z.strictObject({
  note: z.int().positive(),
  atMs: epochMs,
  fence: fenceSchema,
});

/** Parses a note list query. */
export const noteListSchema: z.ZodType<NoteList> = z.strictObject({
  agentId: idSchema("agt"),
  afterId: z.int().nonnegative().exactOptional(),
  limit: limitSchema,
});

/** Parses a note search: 1 to 200 characters. */
export const noteSearchSchema: z.ZodType<NoteSearch> = z.strictObject({
  agentId: idSchema("agt"),
  query: z.string().min(1).max(200),
  limit: limitSchema,
});
