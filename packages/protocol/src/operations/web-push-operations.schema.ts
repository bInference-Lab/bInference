import { z } from "zod";
import { type Empty, emptyArgsSchema, emptyResultSchema } from "../values/empty.schema.js";
import { readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/**
 * A browser's Web Push subscription, the fields `PushSubscription.toJSON()` gives (W3C Push API):
 * the push service's endpoint and the keys that encrypt a message to the browser (RFC 8291).
 */
export interface WebPushSubscription {
  /** The push service's URL for this browser, HTTPS. */
  readonly endpoint: string;
  readonly keys: {
    /** The browser's P-256 public key, uncompressed, in base64url. */
    readonly p256dh: string;
    /** The 16-byte authentication secret, in base64url. */
    readonly auth: string;
  };
}

/** The answer of `webPush/status`. */
interface WebPushStatus {
  /** The engine's VAPID public key (RFC 8292), the `applicationServerKey` a browser subscribes with. */
  readonly publicKey: string;
  /** Whether the calling console device holds a subscription. */
  readonly registered: boolean;
}

/** The browser push operations of protocol spec section 7.9. */
export interface WebPushOperationShapes {
  readonly "webPush/status": { readonly args: Empty; readonly result: WebPushStatus };
  readonly "webPush/register": {
    readonly args: { readonly subscription: WebPushSubscription };
    readonly result: Empty;
  };
  readonly "webPush/unregister": {
    readonly args: { readonly endpoint: string };
    readonly result: Empty;
  };
}

// An uncompressed P-256 point is 65 bytes and the secret 16, each in base64url, padded or not.
const pointText = /^[A-Za-z0-9_-]{87}=?$/;
const secretText = /^[A-Za-z0-9_-]{22}(?:==)?$/;
// A push service is reached by name: an IP address, `localhost` or a `.localhost` name is refused.
const namedHost = /^(?=.*[a-z])(?!.*\.localhost$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const endpoint = z.url({ protocol: /^https$/, hostname: namedHost }).max(2048);

/** Parses a browser's Web Push subscription. */
export const webPushSubscriptionSchema: z.ZodType<WebPushSubscription> = z.strictObject({
  endpoint,
  keys: z.strictObject({
    p256dh: z.string().regex(pointText),
    auth: z.string().regex(secretText),
  }),
});

/**
 * The browser push operations, by name. A subscription belongs to the console device that
 * registers it, so registering and removing one is device-only (`deviceOnlyOperations`).
 */
export const webPushOperations: OperationTable<WebPushOperationShapes> = {
  "webPush/status": {
    ...readFlags,
    name: "webPush/status",
    scope: "read",
    args: emptyArgsSchema,
    result: z.object({ publicKey: z.string().regex(pointText), registered: z.boolean() }),
  },
  "webPush/register": {
    ...writeFlags,
    name: "webPush/register",
    scope: "confirm",
    args: z.strictObject({ subscription: webPushSubscriptionSchema }),
    result: emptyResultSchema,
  },
  "webPush/unregister": {
    ...writeFlags,
    name: "webPush/unregister",
    scope: "confirm",
    args: z.strictObject({ endpoint }),
    result: emptyResultSchema,
  },
};
