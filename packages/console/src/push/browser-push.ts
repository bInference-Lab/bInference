import type { ProtocolClient } from "@binference/client";
import { base64url, bytesOfBase64url } from "../device/base64url";

/**
 * Browser push as the console reaches it (W3C Push API), so tests can hand it their own: present
 * only in a secure context whose browser has a service worker, the Push API and notifications.
 */
export interface BrowserPush {
  /** The notification permission now: `default`, `granted` or `denied`. */
  readonly permission: () => NotificationPermission;
  /** Asks the owner for the permission; call it only from a click. */
  readonly requestPermission: () => Promise<NotificationPermission>;
  /** Registers the push worker at `/push-worker.js` and resolves with its push manager. */
  readonly manager: () => Promise<PushManager>;
}

/** What this browser's notifications are: off, on, or blocked by the owner. */
export type PushSetting =
  | { readonly kind: "blocked" }
  | { readonly kind: "off" }
  | { readonly kind: "on" };

interface PushContext {
  readonly push: BrowserPush;
  readonly client: ProtocolClient;
  readonly signal: AbortSignal;
}

function keyText(key: ArrayBuffer | null): string {
  return key === null ? "" : base64url(key);
}

async function register(subscription: PushSubscription, context: PushContext): Promise<void> {
  const keys = {
    p256dh: keyText(subscription.getKey("p256dh")),
    auth: keyText(subscription.getKey("auth")),
  };
  await context.client.call(
    "webPush/register",
    { subscription: { endpoint: subscription.endpoint, keys } },
    { signal: context.signal },
  );
}

/**
 * Reads this browser's setting and makes the engine agree with it: a subscription made for
 * another VAPID key (a new machine) is dropped, and one the engine lost is registered again.
 */
export async function readPushSetting(context: PushContext): Promise<PushSetting> {
  const { push, client, signal } = context;
  if (push.permission() === "denied") {
    return { kind: "blocked" };
  }
  const status = await client.call("webPush/status", {}, { signal });
  const subscription = await (await push.manager()).getSubscription();
  if (subscription === null) {
    return { kind: "off" };
  }
  if (keyText(subscription.options.applicationServerKey) !== status.publicKey) {
    await subscription.unsubscribe();
    return { kind: "off" };
  }
  if (!status.registered) {
    await register(subscription, context);
  }
  return { kind: "on" };
}

/**
 * Turns notifications on: asks the permission, subscribes the push worker with the engine's VAPID
 * key, and registers the subscription with the engine. A permission refused is `blocked`.
 */
export async function turnPushOn(context: PushContext): Promise<PushSetting> {
  const { push, client, signal } = context;
  if ((await push.requestPermission()) !== "granted") {
    return { kind: push.permission() === "denied" ? "blocked" : "off" };
  }
  const { publicKey } = await client.call("webPush/status", {}, { signal });
  const manager = await push.manager();
  const subscription = await manager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytesOfBase64url(publicKey),
  });
  await register(subscription, context);
  return { kind: "on" };
}

/** Turns notifications off: the engine drops the subscription, then the browser ends it. */
export async function turnPushOff(context: PushContext): Promise<PushSetting> {
  const subscription = await (await context.push.manager()).getSubscription();
  if (subscription !== null) {
    await context.client.call(
      "webPush/unregister",
      { endpoint: subscription.endpoint },
      { signal: context.signal },
    );
    await subscription.unsubscribe();
  }
  return { kind: "off" };
}
