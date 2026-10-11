import type { ProtocolClient } from "@binference/client";
import type { ConsoleBrowser } from "../app/console-browser";
import type { ConsoleCredential } from "../connection/console-client";
import { createDeviceKey } from "../device/device-key";
import type { DeviceStore, StoredDevice } from "../device/device-store";
import { pairDevice } from "../device/pair-device";
import { pairCodeIn } from "../device/pair-link";
import type { SessionState, SignedOutReason } from "./session-state";

/** What a session opens with. */
export interface SessionContext {
  readonly browser: Pick<
    ConsoleBrowser,
    "readHash" | "clearHash" | "subtle" | "fetch" | "pathname"
  >;
  /** Where the device is kept; `undefined` where the browser has no IndexedDB. */
  readonly store: DeviceStore | undefined;
  /** What the owner sees the device called. */
  readonly label: string;
  /** Opens a client with the credential; it connects when the session asks it to. */
  readonly connect: (credential: ConsoleCredential) => ProtocolClient;
  /** Hears each step, such as `pairing`, before the session ends. */
  readonly report: (state: SessionState) => void;
  readonly signal: AbortSignal;
}

type Found =
  | { readonly kind: "credential"; readonly credential: ConsoleCredential }
  | { readonly kind: "signed_out"; readonly reason: SignedOutReason };

function signedOut(reason: SignedOutReason): Found {
  return { kind: "signed_out", reason };
}

function isMiniPath(pathname: string): boolean {
  return pathname === "/mini" || pathname.startsWith("/mini/");
}

// A Mini App launch: Telegram's launch data and the launch ticket `/console` put beside it in the
// address's fragment.
function miniLaunch(context: SessionContext): Found {
  const fields = new URLSearchParams(context.browser.readHash().slice(1));
  const initData = fields.get("tgWebAppData");
  if (initData === null) {
    return signedOut("mini_failed");
  }
  const ticket = fields.get("ticket");
  const credential: ConsoleCredential = {
    kind: "telegram",
    initData,
    ...(ticket === null ? {} : { ticket }),
  };
  return { kind: "credential", credential };
}

// Pairs this browser with the link's code and keeps the new device in place of any earlier one.
async function pair(context: SessionContext, code: string, store: DeviceStore): Promise<Found> {
  const { subtle, fetch: fetcher } = context.browser;
  if (subtle === undefined) {
    return signedOut("no_crypto");
  }
  // The code leaves the address before anything can fail, so a timeout leaves no code behind.
  context.browser.clearHash();
  context.report({ kind: "pairing" });
  const key = await createDeviceKey(subtle);
  const paired = await pairDevice(fetcher, {
    code,
    key,
    label: context.label,
    signal: context.signal,
  });
  if (!paired.ok) {
    return signedOut(paired.refusal);
  }
  const device: StoredDevice = {
    deviceId: paired.deviceId,
    alg: key.alg,
    privateKey: key.privateKey,
  };
  await store.save(device);
  return { kind: "credential", credential: { kind: "device", device } };
}

// `/mini` signs in with its launch alone: it never pairs nor uses a device key this browser keeps,
// as it is the one page Telegram may frame.
async function findCredential(context: SessionContext): Promise<Found> {
  if (isMiniPath(context.browser.pathname)) {
    return miniLaunch(context);
  }
  const { store } = context;
  if (store === undefined || context.browser.subtle === undefined) {
    return signedOut("no_crypto");
  }
  const code = pairCodeIn(context.browser.readHash());
  if (code !== undefined) {
    return pair(context, code, store);
  }
  const device = await store.load();
  return device === undefined
    ? signedOut("no_device")
    : { kind: "credential", credential: { kind: "device", device } };
}

// The protocol or client error code a failed connect carries, such as `auth.revoked`.
function codeOf(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

// A refusal of the device itself forgets it, so the page asks for a new link.
async function refusalOf(
  context: SessionContext,
  credential: ConsoleCredential,
  code: string | undefined,
): Promise<SignedOutReason> {
  if (credential.kind === "telegram") {
    if (code === "auth.expired") {
      return "mini_expired";
    }
    return code?.startsWith("auth.") === true ? "mini_failed" : "unreachable";
  }
  if (code === "auth.revoked" || code === "auth.invalid") {
    await context.store?.forget();
    return code === "auth.revoked" ? "revoked" : "no_device";
  }
  return code === "auth.origin" ? "refused" : "unreachable";
}

/**
 * Signs the console in: at `/mini`, only a Mini App launch with its Telegram data, and without one
 * the page says to open it from the bot; elsewhere a `#pair=` link pairs a new device key first,
 * or the device this browser keeps signs in. Resolves with the session
 * ready, or signed out with the reason the sign-in page shows.
 */
export async function openSession(context: SessionContext): Promise<SessionState> {
  context.signal.throwIfAborted();
  context.report({ kind: "starting" });
  const found = await findCredential(context);
  if (found.kind === "signed_out") {
    return found;
  }
  context.report({ kind: "connecting" });
  const client = context.connect(found.credential);
  try {
    const ready = await client.connect(context.signal);
    return { kind: "ready", client, ready };
  } catch (error) {
    client.close();
    const code = error instanceof Error ? codeOf(error) : undefined;
    return { kind: "signed_out", reason: await refusalOf(context, found.credential, code) };
  }
}
