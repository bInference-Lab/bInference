import { BinferenceError } from "@binference/core";
import { GrammyError, HttpError } from "grammy";

const secondMs = 1000;

function refusal(method: string, error: GrammyError): BinferenceError {
  const status = error.error_code;
  const details = { method, status };
  if (status === 401 || status === 404) {
    return new BinferenceError({
      code: "telegram.bad_token",
      message: "Telegram refused the bot token. Check telegram.botToken.",
      details,
    });
  }
  if (status === 409) {
    return new BinferenceError({
      code: "telegram.poll_conflict",
      message: "Another program polls this bot, or a webhook is set for it.",
      details,
    });
  }
  if (status === 429) {
    const retryAfterMs = (error.parameters.retry_after ?? 1) * secondMs;
    return new BinferenceError({
      code: "telegram.flood",
      message: "Telegram asked the bot to wait before its next call.",
      retryable: true,
      details: { ...details, retryAfterMs },
    });
  }
  return new BinferenceError({
    code: "telegram.api_refused",
    message: "Telegram refused a Bot API call.",
    retryable: status >= 500,
    details,
  });
}

/**
 * Maps a failed Bot API call to a `BinferenceError`: `telegram.bad_token`, `telegram.poll_conflict`,
 * `telegram.flood` (with `retryAfterMs`), `telegram.api_refused` or `telegram.unreachable`. The
 * Bot API's own error never becomes the cause: its request URL holds the bot token, and its payload
 * holds the chat text.
 */
export function botApiFault(error: unknown, method: string): BinferenceError {
  if (error instanceof GrammyError) {
    return refusal(method, error);
  }
  return new BinferenceError({
    code: error instanceof HttpError ? "telegram.unreachable" : "telegram.api_failed",
    message: `The Bot API call ${method} got no answer.`,
    retryable: error instanceof HttpError,
    details: { method },
  });
}
