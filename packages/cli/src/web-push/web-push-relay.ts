import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { BinferenceError, type Clock, type Http, type Logger, type Random } from "@binference/core";
import type { EnginePush } from "@binference/engine";
import type { WebPushSubscriptionRecord, WebPushSubscriptions } from "@binference/engine/access";
import { createFormatter } from "@binference/i18n";
import type { OwnerInfo } from "@binference/protocol";
import { z } from "zod";
import { type PushOutcome, sendPushMessage } from "./send-push-message.js";
import type { WebPushKey } from "./web-push-key.js";

/** The line that carries card pushes to the owner's browsers, in the order they came. */
export interface WebPushRelay {
  /**
   * Takes one engine push. A card version that opens, and one that closes, reaches every browser
   * push subscription made for the engine's key; a subscription made for another key, or one its
   * push service says is gone, is dropped. A failure is logged and never reaches the engine; past
   * 1,000 pushes waiting, a push is dropped and logged.
   */
  relay(push: EnginePush): void;
  /** Resolves once every push relayed so far was sent, or failed and was logged. */
  idle(): Promise<void>;
  /** Stops the relay: aborts the requests in flight and waits for them to end. */
  close(): Promise<void>;
}

/** What the relay sends through. */
export interface WebPushRelayContext {
  readonly subscriptions: WebPushSubscriptions;
  readonly key: WebPushKey;
  readonly http: Http;
  /** The owner's language now, for the words of each message. */
  readonly owner: () => OwnerInfo;
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
}

/** One card moment: the card's id and intent, and how long a message about it is worth keeping. */
interface CardMoment {
  readonly kind: "opened" | "closed";
  readonly intent: string;
  readonly card: string;
  /** When the card version expires, for an open. */
  readonly expiresAt?: number;
}

const momentSchema = z.object({
  intent: z.string().min(1).max(64),
  card: z.string().min(1).max(64),
  expiresAt: z.number().optional(),
});

// Past this many pushes waiting, a push is dropped: the card stays on every other surface.
const maxWaiting = 1_000;
// A close is worth delivering while a browser may still show the open: 10 minutes.
const closedTtlSec = 600;

function momentOf(push: EnginePush): CardMoment | undefined {
  if (push.kind !== "card/opened" && push.kind !== "card/closed") {
    return undefined;
  }
  const data = momentSchema.safeParse(push.data);
  if (!data.success) {
    return undefined;
  }
  const kind = push.kind === "card/opened" ? "opened" : "closed";
  const { intent, card, expiresAt } = data.data;
  return { kind, intent, card, ...(expiresAt === undefined ? {} : { expiresAt }) };
}

// RFC 8030: a topic is at most 32 characters of the URL-safe base64 alphabet; one per intent, so
// a close replaces an open the push service still holds.
function topicOf(intent: string): string {
  return createHash("sha256").update(intent).digest("base64url").slice(0, 32);
}

// The message names the card and its intent, and the words in the owner's language; never an
// amount, an address, a token or an agent.
function plaintextOf(moment: CardMoment, owner: OwnerInfo): Uint8Array {
  const words = createFormatter({ locale: owner.locale, timeZone: owner.timezone });
  const message = {
    v: 1,
    kind: moment.kind,
    intent: moment.intent,
    card: moment.card,
    title: words.message(`webPush.${moment.kind}.title`),
    body: words.message(`webPush.${moment.kind}.body`),
  };
  return new Uint8Array(Buffer.from(JSON.stringify(message), "utf8"));
}

function ttlOf(moment: CardMoment, nowMs: number): number {
  return moment.expiresAt === undefined
    ? closedTtlSec
    : Math.ceil(Math.max(0, moment.expiresAt - nowMs) / 1000);
}

interface Delivery {
  readonly moment: CardMoment;
  readonly plaintext: Uint8Array;
  readonly signal: AbortSignal;
}

async function deliverTo(
  subscription: WebPushSubscriptionRecord,
  delivery: Delivery,
  context: WebPushRelayContext,
): Promise<PushOutcome> {
  const { moment } = delivery;
  return sendPushMessage(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      plaintext: delivery.plaintext,
      ttlSec: ttlOf(moment, context.clock.now()),
      urgency: moment.kind === "opened" ? "high" : "normal",
      topic: topicOf(moment.intent),
    },
    { ...context, signal: delivery.signal },
  );
}

// Sends to one subscription and keeps the store true to what the push service said. A log line
// names the answer's status, never the endpoint, which works as a capability.
async function deliver(
  subscription: WebPushSubscriptionRecord,
  delivery: Delivery,
  context: WebPushRelayContext,
): Promise<void> {
  const call = { signal: delivery.signal };
  const drop = { endpoint: subscription.endpoint, deviceId: subscription.deviceId };
  if (subscription.serverKey !== context.key.publicKey) {
    await context.subscriptions.dropWebPushSubscription(drop, call);
    context.logger.info("web_push.stale_key_dropped");
    return;
  }
  try {
    const outcome = await deliverTo(subscription, delivery, context);
    const status = { errorCode: `http.${String(outcome.status)}` };
    if (outcome.kind === "gone") {
      await context.subscriptions.dropWebPushSubscription(drop, call);
      context.logger.info("web_push.gone_dropped", status);
    } else if (outcome.kind === "refused") {
      context.logger.warn("web_push.refused", status);
    }
  } catch (error) {
    if (delivery.signal.aborted) {
      return;
    }
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    context.logger.warn("web_push.not_sent", { errorCode });
  }
}

async function run(moment: CardMoment, context: WebPushRelayContext, signal: AbortSignal) {
  const subscriptions = await context.subscriptions.listWebPushSubscriptions({ signal });
  const plaintext = plaintextOf(moment, context.owner());
  const delivery = { moment, plaintext, signal };
  await Promise.all(subscriptions.map(async (item) => deliver(item, delivery, context)));
}

/**
 * Creates the relay of the owner's browsers (decision 0158): each card version that opens or
 * closes becomes one encrypted message to every browser push subscription, in the order the
 * pushes came, each request through the `Http` port.
 */
export function createWebPushRelay(context: WebPushRelayContext): WebPushRelay {
  const stop = new AbortController();
  let line: Promise<void> = Promise.resolve();
  let waiting = 0;
  const runLogged = async (moment: CardMoment): Promise<void> => {
    try {
      await run(moment, context, stop.signal);
    } catch (error) {
      if (!stop.signal.aborted) {
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        context.logger.warn("web_push.relay_failed", { intentId: moment.intent, errorCode });
      }
    }
    waiting -= 1;
  };
  return {
    relay(push) {
      const moment = momentOf(push);
      if (moment === undefined || stop.signal.aborted) {
        return;
      }
      if (waiting >= maxWaiting) {
        context.logger.warn("web_push.relay_full", { intentId: moment.intent });
        return;
      }
      waiting += 1;
      line = line.then(async () => runLogged(moment));
    },
    idle: async () => line,
    async close() {
      stop.abort();
      await line;
    },
  };
}
