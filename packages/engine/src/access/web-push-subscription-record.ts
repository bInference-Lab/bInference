import { type Id, idSchema, type Result } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * A console device's browser push subscription (decision 0158): where its push service takes
 * messages for the browser, the browser's keys that each message is encrypted to, and the VAPID
 * public key the browser subscribed with.
 */
export interface WebPushSubscriptionRecord {
  /** The push service's HTTPS URL for this browser; one subscription per endpoint. */
  readonly endpoint: string;
  readonly deviceId: Id<"dev">;
  /** The browser's P-256 public key, uncompressed, in base64url. */
  readonly p256dh: string;
  /** The browser's 16-byte authentication secret, in base64url. */
  readonly auth: string;
  /** The engine's VAPID public key the browser subscribed with, in base64url. */
  readonly serverKey: string;
  readonly createdAtMs: number;
}

/** Parses a browser push subscription record. */
export const webPushSubscriptionRecordSchema: z.ZodType<WebPushSubscriptionRecord> = z.strictObject(
  {
    endpoint: z.string().min(1).max(2048),
    deviceId: idSchema("dev"),
    p256dh: z.string().min(1).max(128),
    auth: z.string().min(1).max(64),
    serverKey: z.string().min(1).max(128),
    createdAtMs: epochMsSchema,
  },
);

/** Which subscription to drop: the one at an endpoint, only when it is that device's if named. */
export interface WebPushDrop {
  readonly endpoint: string;
  readonly deviceId?: Id<"dev">;
}

/** Parses a subscription drop. */
export const webPushDropSchema: z.ZodType<WebPushDrop> = z.strictObject({
  endpoint: z.string().min(1).max(2048),
  deviceId: idSchema("dev").exactOptional(),
});

/** The most browser push subscriptions one console device keeps; a new one drops the oldest. */
export const maxWebPushSubscriptionsPerDevice: number = 4;

/** The access store's part that keeps the browser push subscriptions, which `AccessStore` takes on. */
export interface WebPushSubscriptions {
  /**
   * Saves a device's browser push subscription, in place of one at the same endpoint, then drops
   * the device's oldest past {@link maxWebPushSubscriptionsPerDevice}; a device that is unknown or
   * revoked is `no_device`.
   */
  saveWebPushSubscription(
    subscription: WebPushSubscriptionRecord,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<WebPushSubscriptionRecord, "no_device">>;
  /** Every browser push subscription, oldest first. */
  listWebPushSubscriptions(options: {
    readonly signal: AbortSignal;
  }): Promise<readonly WebPushSubscriptionRecord[]>;
  /**
   * Drops the subscription at an endpoint, only when it is the named device's if `deviceId` is
   * set; none there is `not_found`.
   */
  dropWebPushSubscription(
    drop: WebPushDrop,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<WebPushSubscriptionRecord, "not_found">>;
}
