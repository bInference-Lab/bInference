import {
  BinferenceError,
  type Clock,
  createIdSource,
  type Random,
  retry,
  type RetryPolicy,
} from "@binference/core";
import { operations } from "@binference/protocol";
import { type CallClient, type CallSlots, isClientBusy } from "./call-slots.js";

/** What a resending client waits through and makes keys with. */
export interface ResendPorts {
  readonly clock: Clock;
  readonly random: Random;
}

// The engine's refusals that show a call never ran: it answers busy and starting before it reads
// a key or runs a handler (decision 0442).
const engineRefusedUnrun: ReadonlySet<string> = new Set(["protocol.busy", "engine.starting"]);

/**
 * How the runtime sends a call the engine refused again (decision 0442): at most 5 attempts, so
 * at most 4 waits, each with full jitter under 250 ms doubling to 2 seconds, 3.75 seconds in all.
 * The caller's own signal, such as an end write's 10 seconds, bounds the rest.
 */
const resendPolicy: RetryPolicy = {
  attempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  budgetMs: Number.POSITIVE_INFINITY,
};

function hasNeverRun(error: Readonly<Error>): boolean {
  return error instanceof BinferenceError && engineRefusedUnrun.has(error.code);
}

// A call the client had no room for waits until a call of the link settles, then goes again, as
// long as its signal allows; it never counts as an attempt.
async function sendWhenRoom<T>(
  slots: CallSlots,
  send: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!(error instanceof Error && isClientBusy(error))) {
      throw error;
    }
    await slots.freed(signal);
    return sendWhenRoom(slots, send, signal);
  }
}

/**
 * The runtime's client that sends a call again when the call never ran (decision 0442): refused
 * `protocol.busy` or `engine.starting` by the engine, after a wait of `resendPolicy`, or
 * `client.busy` by its own client, once a call of the link settled, until the call's signal
 * aborts. Every other failure, `engine.timeout` among them, rejects at once, since the call may
 * have run. A write keeps one key across its attempts: the caller's, or one made before the
 * first, so a resend never runs twice.
 */
export function createResendingClient(slots: CallSlots, ports: ResendPorts): CallClient {
  const ids = createIdSource(ports);
  return {
    async call(op, args, options) {
      const isWrite = operations[op].idempotency === "key";
      const key = options.key ?? (isWrite ? ids.next("key") : undefined);
      const sent = key === undefined ? options : { ...options, key };
      const send = async (signal: AbortSignal) =>
        sendWhenRoom(slots, async () => slots.call(op, args, { ...sent, signal }), signal);
      return retry(async ({ signal }) => send(signal), {
        ...resendPolicy,
        ...ports,
        signal: options.signal,
        isRetryable: hasNeverRun,
      });
    },
  };
}
