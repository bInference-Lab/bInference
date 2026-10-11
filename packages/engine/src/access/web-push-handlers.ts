import { type Clock, type Id, isId, ok, err } from "@binference/core";
import type { EngineCaller, EngineHandler } from "../operations/engine-call.js";
import type { AccessStore } from "../ports.js";

/** The handlers of the browser push operations (protocol spec, section 7.9; decision 0158). */
export interface WebPushHandlers {
  readonly "webPush/status": EngineHandler<"webPush/status">;
  readonly "webPush/register": EngineHandler<"webPush/register">;
  readonly "webPush/unregister": EngineHandler<"webPush/unregister">;
}

/** What the browser push handlers read and write through. */
export interface WebPushHandlersOptions {
  readonly access: AccessStore;
  readonly clock: Clock;
  /** The engine's VAPID public key in base64url, which every browser subscribes with. */
  readonly publicKey: string;
}

// The server lets only a paired console device call the writes; anything else is no device.
function deviceOf(caller: EngineCaller): Id<"dev"> | undefined {
  return isId("dev", caller.credential) ? caller.credential : undefined;
}

/**
 * Creates the browser push handlers. `webPush/status` answers the VAPID public key and whether
 * the calling device holds a subscription made for it. `webPush/register` saves the calling
 * device's subscription, with the key it was made for, in place of one at the same endpoint; a
 * device revoked meanwhile is `auth.revoked`. `webPush/unregister` drops the calling device's
 * subscription at the endpoint, and one it does not hold changes nothing. A caller that is no
 * console device is `auth.device_only`.
 */
export function createWebPushHandlers(options: WebPushHandlersOptions): WebPushHandlers {
  const { access, clock, publicKey } = options;
  return {
    async "webPush/status"({ caller, signal }) {
      const device = deviceOf(caller);
      const subscriptions =
        device === undefined ? [] : await access.listWebPushSubscriptions({ signal });
      const registered = subscriptions.some(
        (subscription) => subscription.deviceId === device && subscription.serverKey === publicKey,
      );
      return ok({ publicKey, registered });
    },
    async "webPush/register"({ args, caller, signal }) {
      const deviceId = deviceOf(caller);
      if (deviceId === undefined) {
        return err("auth.device_only");
      }
      const { endpoint, keys } = args.subscription;
      const saved = await access.saveWebPushSubscription(
        { endpoint, deviceId, ...keys, serverKey: publicKey, createdAtMs: clock.now() },
        { signal },
      );
      return saved.ok ? ok({}) : err("auth.revoked");
    },
    async "webPush/unregister"({ args, caller, signal }) {
      const deviceId = deviceOf(caller);
      if (deviceId === undefined) {
        return err("auth.device_only");
      }
      await access.dropWebPushSubscription({ endpoint: args.endpoint, deviceId }, { signal });
      return ok({});
    },
  };
}
