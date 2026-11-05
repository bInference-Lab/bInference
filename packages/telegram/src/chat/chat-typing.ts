import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { Api } from "grammy";
import { callBotApi } from "../api/call-bot-api.js";
import { previewSignal } from "../throttle/preview-signal.js";

/** What the typing indicator is sent and timed with. */
export interface TypingParts {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** The typing indicator of one running turn, in the owner's chat. */
export interface ChatTyping {
  /** Ends the indicator: no more is sent, and the one under way goes no further. */
  stop(): void;
}

// Telegram shows the indicator for 5 seconds, so it is sent again before then.
const renewMs = 4_000;
// Failures in a row, a dropped send left out, before the indicator stops for the turn.
const maxFailures = 5;

function codeOf(error: ErrorOptions["cause"]): string {
  return error instanceof BinferenceError ? error.code : "unexpected";
}

// One send of the indicator: answers the failures in a row after it. A send the throttler
// dropped, for a call in line or a wait in its chat, changes nothing.
async function sendTyping(
  parts: TypingParts,
  at: { readonly chatId: number; readonly signal: AbortSignal },
  failures: number,
): Promise<number> {
  try {
    const signal = previewSignal(at.signal);
    await callBotApi("sendChatAction", signal, async (sent) =>
      parts.api.sendChatAction(at.chatId, "typing", {}, sent),
    );
    return 0;
  } catch (error) {
    if (at.signal.aborted || codeOf(error) === "telegram.preview_dropped") {
      return failures;
    }
    parts.logger.info("telegram.typing_failed", { errorCode: codeOf(error) });
    return failures + 1;
  }
}

async function typeUntilStopped(
  parts: TypingParts,
  at: { readonly chatId: number; readonly signal: AbortSignal },
): Promise<void> {
  let failures = 0;
  while (failures < maxFailures && !at.signal.aborted) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one send at a time, then its wait
    failures = await sendTyping(parts, at, failures);
    // oxlint-disable-next-line eslint/no-await-in-loop -- the next send waits for its time
    await parts.clock.sleep(renewMs, at.signal).catch(() => undefined);
  }
}

/**
 * Shows Telegram's typing indicator in a chat while a turn runs (decision 0372): at once, then
 * every 4 seconds, one send at a time, until it is stopped. Each send gives way to the chat's
 * other calls and to a wait Telegram asked for, and is skipped then, never queued; after 5
 * failures in a row the indicator stops for the turn.
 */
export function startTyping(parts: TypingParts, chatId: number): ChatTyping {
  const stopped = new AbortController();
  void typeUntilStopped(parts, { chatId, signal: stopped.signal });
  return {
    stop: () => {
      stopped.abort();
    },
  };
}
