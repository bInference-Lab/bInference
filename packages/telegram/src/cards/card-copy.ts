import { type Id, idSchema } from "@binference/core";
import { z } from "zod";

/** One Telegram copy of a card version: the message that becomes its receipt. */
export interface CardCopy {
  /** The card version's callback reference, unique to the version. */
  readonly ref: string;
  readonly intent: Id<"int">;
  readonly cardVersion: number;
  readonly chatId: number;
  readonly messageId: number;
}

/** Parses a card copy as a store keeps it. */
export const cardCopySchema: z.ZodType<CardCopy> = z.strictObject({
  ref: z.string().regex(/^[\w-]{16}$/, { message: "Expected 12 bytes in base64url." }),
  intent: idSchema("int"),
  cardVersion: z.int().positive(),
  chatId: z.int(),
  messageId: z.int().positive(),
});
