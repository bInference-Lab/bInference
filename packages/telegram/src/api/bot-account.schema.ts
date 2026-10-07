import { BinferenceError } from "@binference/core";
import { z } from "zod";

/** The bot behind a token, as `getMe` reports it. */
export interface BotAccount {
  /** The bot's numeric Telegram id: the part of the token before the colon. */
  readonly id: number;
  /** The bot's username without the `@`, which pairing links name. */
  readonly username: string;
  /** Whether people can add the bot to groups (`can_join_groups`). */
  readonly canJoinGroups: boolean;
  /** Whether privacy mode is off, so the bot reads every group message. */
  readonly readsAllGroupMessages: boolean;
}

// The Bot API's `User` as `getMe` answers it (core.telegram.org/bots/api#user); every field read
// is checked, and the fields Telegram may add later are dropped.
const getMeAnswer = z.looseObject({
  id: z.int().positive(),
  is_bot: z.literal(true),
  username: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/),
  can_join_groups: z.boolean().optional(),
  can_read_all_group_messages: z.boolean().optional(),
});

/** Parses a bot account. */
export const botAccountSchema: z.ZodType<BotAccount> = z.strictObject({
  id: z.int().positive(),
  username: z.string().min(1),
  canJoinGroups: z.boolean(),
  readsAllGroupMessages: z.boolean(),
});

/**
 * Reads `getMe`'s answer. Throws `telegram.bad_answer` when it is no bot with a username, which
 * every bot BotFather makes has.
 */
export function botAccountOf(answer: unknown): BotAccount {
  const read = getMeAnswer.safeParse(answer);
  if (!read.success) {
    throw new BinferenceError({
      code: "telegram.bad_answer",
      message: "getMe answered something other than a bot with a username.",
    });
  }
  return {
    id: read.data.id,
    username: read.data.username,
    canJoinGroups: read.data.can_join_groups ?? false,
    readsAllGroupMessages: read.data.can_read_all_group_messages ?? false,
  };
}
