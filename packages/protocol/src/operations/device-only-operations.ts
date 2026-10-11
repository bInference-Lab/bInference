import type { OperationName } from "./operations.js";

/**
 * The operations only a paired console device may call, whatever scopes another client holds: a
 * browser push subscription belongs to the device that registers it. Any other caller fails with
 * `auth.device_only`.
 */
export const deviceOnlyOperations: ReadonlySet<OperationName> = new Set([
  "webPush/register",
  "webPush/unregister",
]);

/** Whether only a paired console device may call the operation. */
export function isDeviceOnly(name: OperationName): boolean {
  return deviceOnlyOperations.has(name);
}
