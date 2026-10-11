import type { Clock, Http, Random } from "@binference/core";
import {
  encryptPushMessage,
  newPushSenderParts,
  type PushReceiverKeys,
} from "./encrypt-push-message.js";
import { vapidAuthorization } from "./vapid-authorization.js";
import type { WebPushKey } from "./web-push-key.js";

/** One push message for one browser, before encryption. */
export interface PushMessage {
  /** The subscription's endpoint, where the push service takes messages for the browser. */
  readonly endpoint: string;
  readonly keys: PushReceiverKeys;
  /** The message, which only the browser can read. */
  readonly plaintext: Readonly<Uint8Array>;
  /** How long the push service keeps an undelivered message, in seconds (RFC 8030 `TTL`). */
  readonly ttlSec: number;
  readonly urgency: "high" | "normal";
  /** Replaces an undelivered message with the same topic (RFC 8030 `Topic`). */
  readonly topic: string;
}

/**
 * What the push service answered: `sent` for a 2xx, `gone` for 404 or 410, when the subscription
 * no longer exists, `refused` for any other status.
 */
export type PushOutcome =
  | { readonly kind: "sent" | "gone"; readonly status: number }
  | { readonly kind: "refused"; readonly status: number };

/** What a push request is sent with. */
export interface PushSendContext {
  readonly http: Http;
  readonly key: WebPushKey;
  readonly clock: Clock;
  readonly random: Random;
  readonly signal: AbortSignal;
}

// A push service answers at once or not at all; past this the message counts as not sent.
const requestTimeoutMs = 10_000;

function outcomeOf(status: number): PushOutcome {
  if (status >= 200 && status < 300) {
    return { kind: "sent", status };
  }
  return status === 404 || status === 410 ? { kind: "gone", status } : { kind: "refused", status };
}

/**
 * Sends one message to a browser's push service (RFC 8030): encrypted to the browser with
 * `aes128gcm` (RFC 8291), with the VAPID authorization (RFC 8292), its `TTL`, `Urgency` and
 * `Topic`, through the `Http` port within 10 seconds. A request that gets no answer rejects as the
 * port does.
 */
export async function sendPushMessage(
  message: PushMessage,
  context: PushSendContext,
): Promise<PushOutcome> {
  const parts = newPushSenderParts(context.random.bytes(16));
  const body = encryptPushMessage(message.plaintext, message.keys, parts);
  const answer = await context.http.request({
    method: "POST",
    url: message.endpoint,
    headers: {
      authorization: vapidAuthorization(message.endpoint, context.key, context.clock.now()),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(Math.max(0, Math.floor(message.ttlSec))),
      urgency: message.urgency,
      topic: message.topic,
    },
    bodyBytes: body,
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(requestTimeoutMs)]),
  });
  return outcomeOf(answer.status);
}
