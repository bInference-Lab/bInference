import type { Clock, Logger } from "@binference/core";
import type { Transformer } from "grammy";
import { assertGrammySignal, type GrammySignal } from "../api/assert-grammy-signal.js";
import { abortReasonOf, chatIdOf, floodWaitMsOf } from "./bot-call.schema.js";

/** What a bot's throttler waits through and reports to. */
export interface BotThrottlerOptions {
  readonly clock: Clock;
  readonly logger: Logger;
  /** The longest one attempt of a call may take; 30 seconds when absent. */
  readonly attemptTimeoutMs?: number;
}

/** Where one chat stands: the calls in line for it, and when it may take the next one. */
interface ChatPace {
  /** Settles once every call in line before the newest is done. */
  readonly tail: Promise<void>;
  readonly inLine: number;
  readonly readyAtMs: number;
}

/** One bot's throttle: each chat's pace, and the send times reserved in the last second. */
interface Throttle {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly attemptTimeoutMs: number;
  readonly paces: Map<string, ChatPace>;
  readonly slots: number[];
}

/** One call as the throttle sends it: its chat, its spacing, its caller's signal. */
interface ThrottledCall<R> {
  readonly key: string;
  readonly spacingMs: number;
  readonly signal: AbortSignal;
  readonly send: (attempt: AbortSignal) => Promise<R>;
}

// Telegram's limits for one bot: about one message a second in a chat, 20 a minute in a group,
// and 30 a second in all (core.telegram.org/bots/faq).
const privateSpacingMs = 1000;
const groupSpacingMs = 3000;
const windowMs = 1000;
const callsPerWindow = 30;
// A call waits out 429s for at most this long in all; then the 429 reaches its caller.
const floodBudgetMs = 5 * 60_000;
const defaultAttemptTimeoutMs = 30_000;
// Past this many chats, the ones with nothing in line and no wait left are forgotten.
const maxKnownChats = 256;
const idle: ChatPace = { tail: Promise.resolve(), inLine: 0, readyAtMs: 0 };
const settled = (): void => undefined;

function spacingMsOf(chatId: number | string | undefined): number {
  if (chatId === undefined) {
    return 0;
  }
  return typeof chatId === "number" && chatId > 0 ? privateSpacingMs : groupSpacingMs;
}

function paceOf(throttle: Throttle, key: string): ChatPace {
  return throttle.paces.get(key) ?? idle;
}

function isIdle(throttle: Throttle, pace: ChatPace): boolean {
  return pace.inLine === 0 && pace.readyAtMs <= throttle.clock.now();
}

// Reserves the next send time within the bot's 30 a second, in the order calls ask for one.
function reserveSlot(throttle: Throttle): number {
  const { slots } = throttle;
  const now = throttle.clock.now();
  while ((slots[0] ?? now) <= now - windowMs) {
    slots.shift();
  }
  const blocking = slots.length < callsPerWindow ? undefined : slots.at(-callsPerWindow);
  const slotMs = Math.max(now, blocking === undefined ? now : blocking + windowMs);
  slots.push(slotMs);
  return slotMs;
}

async function waitForTurn<R>(throttle: Throttle, call: ThrottledCall<R>): Promise<void> {
  const { clock, paces } = throttle;
  const chatWaitMs = paceOf(throttle, call.key).readyAtMs - clock.now();
  if (chatWaitMs > 0) {
    await clock.sleep(chatWaitMs, call.signal);
  }
  const slotMs = reserveSlot(throttle);
  if (slotMs > clock.now()) {
    await clock.sleep(slotMs - clock.now(), call.signal);
  }
  const pace = paceOf(throttle, call.key);
  paces.set(call.key, { ...pace, readyAtMs: Math.max(pace.readyAtMs, slotMs + call.spacingMs) });
}

function pause(throttle: Throttle, key: string, waitMs: number): void {
  const pace = paceOf(throttle, key);
  const readyAtMs = Math.max(pace.readyAtMs, throttle.clock.now() + waitMs);
  throttle.paces.set(key, { ...pace, readyAtMs });
  throttle.logger.warn("telegram.flood_wait", { durationMs: waitMs });
}

// Sends until Telegram answers with anything but a 429, or the waits pass the budget.
async function sendUntilAnswered<R>(
  throttle: Throttle,
  call: ThrottledCall<R>,
  waitedMs: number,
): Promise<R> {
  await waitForTurn(throttle, call);
  const timeout = AbortSignal.timeout(throttle.attemptTimeoutMs);
  const answer = await call.send(AbortSignal.any([call.signal, timeout]));
  const floodMs = floodWaitMsOf(answer);
  if (floodMs === undefined || waitedMs + floodMs > floodBudgetMs) {
    return answer;
  }
  pause(throttle, call.key, floodMs);
  return sendUntilAnswered(throttle, call, waitedMs + floodMs);
}

// Resolves once `waited` settles; rejects with the signal's reason as soon as it aborts.
async function untilSettled(waited: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason);
    };
    const onSettled = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void waited.then(onSettled);
  });
}

function leaveLine(throttle: Throttle, key: string): void {
  const { paces } = throttle;
  const pace = { ...paceOf(throttle, key), inLine: paceOf(throttle, key).inLine - 1 };
  if (isIdle(throttle, pace)) {
    paces.delete(key);
  } else {
    paces.set(key, pace);
  }
  if (paces.size > maxKnownChats) {
    for (const [known, knownPace] of paces) {
      if (isIdle(throttle, knownPace)) {
        paces.delete(known);
      }
    }
  }
}

// One call at a time per chat, in the order the calls came.
async function inTurn<R>(throttle: Throttle, call: ThrottledCall<R>): Promise<R> {
  const pace = paceOf(throttle, call.key);
  let release = settled;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = pace.tail.then(async () => done);
  throttle.paces.set(call.key, { ...pace, tail, inLine: pace.inLine + 1 });
  try {
    await untilSettled(pace.tail, call.signal);
    return await sendUntilAnswered(throttle, call, 0);
  } finally {
    release();
    leaveLine(throttle, call.key);
  }
}

// grammY types its signals with an old polyfill; this follows one with a Node signal.
function followed(signal: GrammySignal | undefined) {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort(abortReasonOf(signal));
  };
  if (signal?.aborted === true) {
    abort();
  }
  signal?.addEventListener("abort", abort);
  return { signal: controller.signal, release: () => signal?.removeEventListener("abort", abort) };
}

/**
 * Creates one bot token's throttler as a grammY transformer. Each chat's calls go out in order,
 * spaced by Telegram's limits, and 30 a second at most in all. A 429 pauses only its own chat for
 * the `retry_after` Telegram names, then the call is sent again: the caller sees the answer that
 * follows, never the 429, unless the waits pass five minutes. Other chats keep going.
 * `getUpdates` passes straight through: the poller owns its own waits. Each attempt is bounded by
 * `attemptTimeoutMs`, so a caller's signal only has to say when to stop.
 */
export function createBotThrottler(options: BotThrottlerOptions): Transformer {
  const throttle: Throttle = {
    clock: options.clock,
    logger: options.logger,
    attemptTimeoutMs: options.attemptTimeoutMs ?? defaultAttemptTimeoutMs,
    paces: new Map(),
    slots: [],
  };
  // grammY hands a transformer four arguments; a rest tuple keeps them typed together.
  return async (...call) => {
    const [prev, method, payload, signal] = call;
    if (method === "getUpdates") {
      return prev(method, payload, signal);
    }
    const chatId = chatIdOf(payload);
    const caller = followed(signal);
    try {
      return await inTurn(throttle, {
        key: chatId === undefined ? "" : String(chatId),
        spacingMs: spacingMsOf(chatId),
        signal: caller.signal,
        send: async (attempt) => prev(method, payload, assertGrammySignal(attempt)),
      });
    } finally {
      caller.release();
    }
  };
}
