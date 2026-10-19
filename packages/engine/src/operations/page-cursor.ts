import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/** Where a page starts: after the item made at `createdAtMs` with `id`. */
export interface PageAfter<P extends string> {
  readonly createdAtMs: number;
  readonly id: Id<P>;
}

// A cursor is the last item of the page before: its creation time and its id, `<ms>:<id>`.
const cursorPattern = /^(0|[1-9]\d{0,14}):(.+)$/;
const createdAtSchema = z.coerce.number<string>().pipe(epochMsSchema);

/**
 * The item a list's cursor names, for ids with `prefix`; `undefined` for a cursor this engine did
 * not write, which the list refuses as `protocol.bad_args`.
 */
export function pageAfterOf<P extends string>(prefix: P, cursor: string): PageAfter<P> | undefined {
  const [, createdAt, id] = cursorPattern.exec(cursor) ?? [];
  const createdAtMs = createdAtSchema.safeParse(createdAt);
  const parsed = idSchema(prefix).safeParse(id);
  return createdAtMs.success && parsed.success
    ? { createdAtMs: createdAtMs.data, id: parsed.data }
    : undefined;
}

/** The cursor of the page after one that ends with `last`. */
export function nextCursorOf(last: { readonly createdAtMs: number; readonly id: string }): string {
  return `${String(last.createdAtMs)}:${last.id}`;
}
