import type { Clock, Http, Logger, Random } from "@binference/core";
import type { AccessStore } from "@binference/engine";
import { createWebPushHandlers, type WebPushHandlers } from "@binference/engine/access";
import type { OwnerInfo } from "@binference/protocol";
import type { WebPushKey } from "../web-push/web-push-key.js";
import { createWebPushRelay, type WebPushRelay } from "../web-push/web-push-relay.js";

/**
 * Browser push's own parts: the VAPID key, the outbound HTTP the messages go through, and the
 * check that an endpoint's host is on the internet.
 */
export interface WebPushParts {
  readonly key: WebPushKey;
  readonly http: Http;
  readonly isPublicEndpoint: (endpoint: string, signal: AbortSignal) => Promise<boolean>;
}

/** What browser push is composed from. */
interface WebPushOptions {
  /** Browser push's own parts; without them, no browser push. */
  readonly webPush?: WebPushParts;
  readonly owner: () => OwnerInfo;
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
}

/**
 * The browser push handlers and the relay of card pushes to the owner's browsers (decision 0158),
 * or no handler and no relay when the options name no browser push.
 */
export function composeWebPush(
  access: AccessStore,
  options: WebPushOptions,
): { readonly handlers: Partial<WebPushHandlers>; readonly relay?: WebPushRelay } {
  const { webPush, clock, random, logger } = options;
  if (webPush === undefined) {
    return { handlers: {} };
  }
  const relay = createWebPushRelay({
    subscriptions: access,
    key: webPush.key,
    http: webPush.http,
    owner: options.owner,
    clock,
    random,
    logger: logger.child("web_push"),
  });
  const handlers = createWebPushHandlers({
    access,
    clock,
    publicKey: webPush.key.publicKey,
    isPublicEndpoint: webPush.isPublicEndpoint,
  });
  return { handlers, relay };
}
