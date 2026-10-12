import { BinferenceError } from "@binference/core";
import { GrammyError, HttpError } from "grammy";
import { z } from "zod";

const secondMs = 1000;
const badRequestStatus = 400;

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

// The codes Node's network stack gives when no connection to Telegram opened, so no request left:
// no DNS answer, a refused or unreachable host, a network that is down, a connect timeout.
const unsentCodes: ReadonlySet<string> = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const codedSchema = z.object({ code: z.string() });
const causedSchema = z.object({ cause: z.unknown() });
// How deep a cause chain is read: grammY's error, the fetch error, the socket error.
const maxCauses = 4;

// Whether an error or one of its causes names a code that proves the request never left, or is
// the poll worker's word that the parent's request never left.
function isUnsent(error: unknown, depth: number): boolean {
  if (depth > maxCauses) {
    return false;
  }
  const code = codedSchema.safeParse(error).data?.code;
  if (code !== undefined && unsentCodes.has(code)) {
    return true;
  }
  if (error instanceof BinferenceError && error.details["isUnsent"] === true) {
    return true;
  }
  const inner =
    error instanceof HttpError ? error.error : causedSchema.safeParse(error).data?.cause;
  return inner !== undefined && isUnsent(inner, depth + 1);
}

/**
 * Whether a failed request never reached Telegram: no connection opened, by the codes Node's
 * network stack gives anywhere in its causes.
 */
export function isUnsentRequest(error: unknown): boolean {
  return isUnsent(error, 0);
}

/**
 * Maps a failed Bot API call to a `BinferenceError`: `telegram.bad_token`, `telegram.poll_conflict`,
 * `telegram.flood` (with `retryAfterMs`), `telegram.api_refused` or `telegram.unreachable`. A
 * `BinferenceError` the bot's throttler raised, such as `telegram.preview_dropped`, stays as it is.
 * `telegram.unreachable` carries `isUnsent: true` only when no connection opened, so the request
 * never reached Telegram; any other network failure may have reached it. The Bot API's own error
 * never becomes the cause: its request URL holds the bot token, and its payload holds the chat
 * text.
 */
export function botApiFault(error: unknown, method: string): BinferenceError {
  // binference's own word from the throttler, such as a dropped preview, stays as it is.
  if (error instanceof BinferenceError) {
    return error;
  }
  if (error instanceof GrammyError) {
    return refusal(method, error);
  }
  if (error instanceof HttpError) {
    return new BinferenceError({
      code: "telegram.unreachable",
      message: `The Bot API call ${method} got no answer.`,
      retryable: true,
      details: { method, isUnsent: isUnsent(error, 0) },
    });
  }
  return new BinferenceError({
    code: "telegram.api_failed",
    message: `The Bot API call ${method} got no answer.`,
    details: { method },
  });
}

/**
 * Whether a fault is Telegram's 400 for a message: one it no longer has, one older than it lets
 * the bot change, or an edit that changes nothing. For an edit or a delete, the work is done.
 */
export function isMessageGone(error: unknown): boolean {
  return (
    error instanceof BinferenceError &&
    error.code === "telegram.api_refused" &&
    error.details["status"] === badRequestStatus
  );
}
