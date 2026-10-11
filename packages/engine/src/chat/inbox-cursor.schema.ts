import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/** Where a page of `inbox/list` starts: after the last message of the page before. */
export interface InboxCursor {
  readonly createdAtMs: number;
  readonly id: Id<"msg">;
}

const inboxCursorSchema: z.ZodType<InboxCursor> = z.strictObject({
  createdAtMs: epochMsSchema,
  id: idSchema("msg"),
});

/** Reads a cursor `inbox/list` handed out; `undefined` for any other text. */
export function parseInboxCursor(text: string): InboxCursor | undefined {
  try {
    const value: unknown = JSON.parse(text);
    const cursor = inboxCursorSchema.safeParse(value);
    return cursor.success ? cursor.data : undefined;
  } catch {
    return undefined;
  }
}

/** The cursor of the page after the one that ends with this message. */
export function inboxCursorOf(cursor: InboxCursor): string {
  return JSON.stringify({ createdAtMs: cursor.createdAtMs, id: cursor.id });
}
