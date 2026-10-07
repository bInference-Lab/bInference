import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { Api } from "grammy";
import { type BotAccount, botAccountOf } from "./bot-account.schema.js";
import { callBotApi } from "./call-bot-api.js";

// A bot token as BotFather writes it: the bot's numeric id, a colon, then the secret part. The
// check keeps any other text out of the Bot API's URL path.
const tokenShape = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/;

/** Why a bot token does not open a bot: it is not written as a token, or Telegram refused it. */
export type BotTokenProblem = "malformed" | "rejected";

/**
 * Checks a bot token with `getMe`, the Bot API's method for testing a token, and answers the bot it
 * opens. The Api carries the token and its throttler, which waits out a 429 for its
 * `retry_after`. A token not written as BotFather writes one is `malformed` and never sent;
 * Telegram's 401 or 404 is `rejected`. Any other failure throws as every Bot API call does:
 * `telegram.flood` once the 429 waits pass five minutes, `telegram.api_refused` (retryable for
 * 5xx), `telegram.unreachable` and `telegram.api_failed`; an answer that is no bot with a
 * username throws `telegram.bad_answer`. The token never reaches a fault.
 */
export async function checkBotToken(
  api: Api,
  call: { readonly signal: AbortSignal },
): Promise<Result<BotAccount, BotTokenProblem>> {
  if (!tokenShape.test(api.token)) {
    return err("malformed");
  }
  try {
    const answer = await callBotApi("getMe", call.signal, async (signal) => api.getMe(signal));
    return ok(botAccountOf(answer));
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "telegram.bad_token") {
      return err("rejected");
    }
    throw error;
  }
}
