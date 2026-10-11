import { z } from "zod";

// Telegram sends more fields on the user (names, language, photo); only the numeric id counts.
const telegramUserSchema = z.object({ id: z.int().positive().max(Number.MAX_SAFE_INTEGER) });

/**
 * Reads the numeric id from a Mini App launch's `user` field, the JSON of Telegram's `WebAppUser`.
 * Text that is not JSON, or carries no positive whole-number id, is `undefined`.
 */
export function decodeTelegramUserId(text: string): number | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = telegramUserSchema.safeParse(value);
  return parsed.success ? parsed.data.id : undefined;
}
