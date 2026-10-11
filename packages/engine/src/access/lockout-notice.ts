import { idSchema } from "@binference/core";
import type { AccessStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import type { Sha256Hex } from "../records/sha256-hex.js";

/** The message key of the notice that failed sign-ins locked something out (spec 4, section 4). */
export const lockoutNoticeKey = "notice.signInsLocked";

/**
 * What too many failed sign-ins or pairings locked out: a remote address (the first
 * `X-Forwarded-For` address for a proxy on this machine), the local socket, the console device or
 * client token a sign-in claimed, or every Mini App launch. A token is named by the SHA-256 of
 * its secret, never the secret.
 */
export type AuthLockout =
  | { readonly kind: "address"; readonly address: string }
  | { readonly kind: "local" }
  | { readonly kind: "device"; readonly device: string }
  | { readonly kind: "token"; readonly secretHash: Sha256Hex }
  | { readonly kind: "mini_app" };

/** One lockout as the server reports it: what, and until when it is refused. */
export type AuthLockoutReport = AuthLockout & { readonly untilMs: number };

/**
 * What the notice names: the kind (`address`, `local`, `device`, `token`, `miniApp`, or `unknown`
 * for a device or token the engine does not have) and its name, an address or the label the
 * owner's browser or CLI gave the credential.
 */
interface LockedName {
  readonly what: "address" | "local" | "device" | "token" | "miniApp" | "unknown";
  readonly name: string;
}

/** The notice that sign-ins are refused, with what is locked and until when. */
export function lockoutNotice(locked: LockedName, untilMs: number): EnginePush {
  return noticePush({
    key: lockoutNoticeKey,
    values: { what: locked.what, name: locked.name },
    times: { until: untilMs },
  });
}

/** What {@link createLockoutNotices} reads and writes. */
export interface LockoutNoticesOptions {
  readonly access: Pick<AccessStore, "findDevice" | "findToken">;
  /** Sends the notice to every surface, through the notice outbox; it must not throw. */
  readonly publish: (push: EnginePush) => void;
}

const lookupTimeoutMs = 5_000;
const unknown: LockedName = { what: "unknown", name: "" };

// The name of what is locked: a credential by the label the store keeps, never its secret.
async function nameOf(
  access: LockoutNoticesOptions["access"],
  lockout: AuthLockout,
): Promise<LockedName> {
  const call = { signal: AbortSignal.timeout(lookupTimeoutMs) };
  if (lockout.kind === "address") {
    return { what: "address", name: lockout.address };
  }
  if (lockout.kind === "local" || lockout.kind === "mini_app") {
    return { what: lockout.kind === "local" ? "local" : "miniApp", name: "" };
  }
  if (lockout.kind === "device") {
    const id = idSchema("dev").safeParse(lockout.device);
    const device = id.success ? await access.findDevice(id.data, call) : undefined;
    return device === undefined ? unknown : { what: "device", name: device.label };
  }
  const token = await access.findToken(lockout.secretHash, call);
  return token === undefined ? unknown : { what: "token", name: token.label };
}

/**
 * Creates the owner's notice of a lockout (spec 4, section 4): it names the address, or reads the
 * locked device's or token's label from the store, and publishes `notice.signInsLocked`. A store
 * that fails to answer names the credential as unknown, so the owner still hears of the lockout.
 * The notice goes out once the label is read; how often a lockout is reported is the server's to
 * bound.
 */
export function createLockoutNotices(
  options: LockoutNoticesOptions,
): (report: AuthLockoutReport) => void {
  return (report) => {
    void nameOf(options.access, report)
      .catch(() => unknown)
      .then((named) => options.publish(lockoutNotice(named, report.untilMs)));
  };
}
