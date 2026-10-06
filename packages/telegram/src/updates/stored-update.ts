import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";

/**
 * What the inbox keeps for one Telegram update: the update as it came, or only its ids when it
 * held a secret, which is never stored.
 */
export interface StoredUpdate {
  /** The update in the Bot API's shape. */
  readonly update: JsonValue;
  /** The update held something that looked like a secret, so only its ids were kept. */
  readonly isRedacted: boolean;
}

/** Parses an inbox entry's payload as a {@link StoredUpdate}. */
export const storedUpdateSchema: z.ZodType<StoredUpdate> = z.strictObject({
  update: jsonValueSchema,
  isRedacted: z.boolean(),
});
