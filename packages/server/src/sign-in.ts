import { Buffer } from "node:buffer";
import { type Clock, err, ok, type Random, type Result, type Secret } from "@binference/core";
import { type AccessStore, type DeviceRecord, sha256Hex } from "@binference/engine";
import type { Credential, ProtocolId, Scope } from "@binference/protocol";
import { isDeviceProofValid } from "./device-proof.js";
import type { Transport } from "./operation-handlers.js";
import type { SeenLaunches } from "./seen-launches.js";
import { checkTelegramLaunch, type TelegramLaunchRefusal } from "./telegram-launch.js";

/** What a Telegram Mini App launch is checked against: the owner's bot and the owner. */
export interface MiniAppAuth {
  /** The owner's bot token, the key of the signature Telegram puts on each launch. */
  readonly botToken: Secret;
  /** The owner's numeric Telegram user id, or `undefined` before the owner paired the bot. */
  readonly ownerId: (options: { readonly signal: AbortSignal }) => Promise<number | undefined>;
}

/** The credentials the server checks every sign-in against. */
export interface ServerAuth {
  /** Client tokens, by the SHA-256 of their secret, and paired console devices. */
  readonly access: AccessStore;
  /** The owner's bot, for Mini App launches; without it every launch fails with `auth.invalid`. */
  readonly miniApp?: MiniAppAuth;
}

/** Why a sign-in fails; the connection ends with a `bye` of this code. */
type SignInRefusal =
  | "auth.required"
  | "auth.invalid"
  | "auth.expired"
  | "auth.revoked"
  | "auth.local_only";

/** A credential that signed in: its id, the scopes it holds and when it stops working. */
export interface Identity {
  readonly credential: string;
  readonly scopes: readonly Scope[];
  /** When a token with an expiry stops working; its connections end then. */
  readonly expiresAtMs?: number;
}

/** A device sign-in that waits for the device to sign the challenge's nonce. */
export interface Challenge {
  /** 32 random bytes in base64url, for the `challenge` frame. */
  readonly nonce: string;
  /** Checks the `prove` frame's signature against the device's key. */
  readonly prove: (
    signature: string,
    signal: AbortSignal,
  ) => Promise<Result<Identity, SignInRefusal>>;
}

/** Where a sign-in stands after `open`: signed in, or waiting for a device's proof. */
type SignInStep =
  | { readonly kind: "signed_in"; readonly identity: Identity }
  | { readonly kind: "challenge"; readonly challenge: Challenge };

/** One `open` to check. */
interface SignInRequest {
  readonly credential: Credential;
  readonly transport: Transport;
  /** The `Origin` the connection arrived with; a device signs it. */
  readonly origin?: string;
}

/** Checks the credential of each `open`. */
export interface SignIn {
  start(request: SignInRequest, signal: AbortSignal): Promise<Result<SignInStep, SignInRefusal>>;
}

/** What a {@link SignIn} reads. Without `auth`, every sign-in fails with `auth.required`. */
export interface SignInOptions {
  readonly auth?: ServerAuth;
  /** The Mini App launches that signed in, refused if they come again. */
  readonly launches: SeenLaunches;
  readonly clock: Clock;
  readonly random: Random;
}

/** The scopes of a paired console device (protocol spec, section 4.1). */
const consoleDeviceScopes: readonly Scope[] = [
  "read",
  "propose",
  "chat",
  "confirm",
  "loosen",
  "admin",
];

/** The scopes of the Telegram Mini App (protocol spec, section 4.1; decision 0089). */
const miniAppScopes: readonly Scope[] = ["read", "chat", "confirm", "loosen"];

/** How far a launch's `auth_date` may lie from now (protocol spec, section 4.2). */
const launchMaxAgeMs: number = 5 * 60_000;

/** How long a launch that signed in is refused if it comes again (protocol spec, section 4.2). */
export const launchRetentionMs: number = 24 * 60 * 60_000;

const nonceBytes = 32;

const launchRefusals: Readonly<Record<TelegramLaunchRefusal, SignInRefusal>> = {
  malformed: "auth.invalid",
  forged: "auth.invalid",
  stale: "auth.expired",
};

/**
 * The credential id of a Mini App connection: the owner's Telegram id, as the owner's chat names
 * the owner in journals and ledger entries.
 */
export function telegramCredentialOf(userId: number): string {
  return `tg:${String(userId)}`;
}

// A launch signs in when Telegram signed it with the owner's bot token, its `auth_date` is fresh,
// the owner opened it, and it never signed in before. The hash is claimed last, after the owner
// check, in one step, so two connections with the same launch never both pass.
async function signInWithLaunch(
  miniApp: MiniAppAuth,
  initData: string,
  context: { readonly options: SignInOptions; readonly signal: AbortSignal },
): Promise<Result<SignInStep, SignInRefusal>> {
  const { clock, launches } = context.options;
  const launch = checkTelegramLaunch({
    initData,
    botToken: miniApp.botToken,
    nowMs: clock.now(),
    maxAgeMs: launchMaxAgeMs,
  });
  if (!launch.ok) {
    return err(launchRefusals[launch.error]);
  }
  const ownerId = await miniApp.ownerId({ signal: context.signal });
  if (ownerId === undefined || ownerId !== launch.value.userId) {
    return err("auth.invalid");
  }
  if (!launches.claim(launch.value.hash, clock.now())) {
    return err("auth.invalid");
  }
  const identity = { credential: telegramCredentialOf(ownerId), scopes: miniAppScopes };
  return ok({ kind: "signed_in", identity });
}

async function signInWithToken(
  access: AccessStore,
  token: string,
  options: { readonly clock: Clock; readonly signal: AbortSignal },
): Promise<Result<SignInStep, SignInRefusal>> {
  const record = await access.findToken(sha256Hex(token), { signal: options.signal });
  if (record === undefined) {
    return err("auth.invalid");
  }
  if (record.revokedAtMs !== undefined) {
    return err("auth.revoked");
  }
  const nowMs = options.clock.now();
  if (record.expiresAtMs !== undefined && nowMs >= record.expiresAtMs) {
    return err("auth.expired");
  }
  await access.markTokenUsed({ id: record.id, atMs: nowMs }, options);
  const expiry = record.expiresAtMs === undefined ? {} : { expiresAtMs: record.expiresAtMs };
  const identity = { credential: record.id, scopes: record.scopes, ...expiry };
  return ok({ kind: "signed_in", identity });
}

interface DeviceStart {
  readonly access: AccessStore;
  readonly device: DeviceRecord;
  readonly origin: string;
}

function challengeDevice(start: DeviceStart, options: SignInOptions): Challenge {
  const nonce = Buffer.from(options.random.bytes(nonceBytes)).toString("base64url");
  return {
    nonce,
    async prove(signature, signal) {
      const proof = { device: start.device, nonce, origin: start.origin, signature };
      if (!isDeviceProofValid(proof)) {
        return err("auth.invalid");
      }
      const seen = { id: start.device.id, atMs: options.clock.now() };
      await start.access.markDeviceSeen(seen, { signal });
      return ok({ credential: start.device.id, scopes: consoleDeviceScopes });
    },
  };
}

async function signInWithDevice(
  access: AccessStore,
  id: ProtocolId<"consoleDevice">,
  context: {
    readonly origin: string;
    readonly options: SignInOptions;
    readonly signal: AbortSignal;
  },
): Promise<Result<SignInStep, SignInRefusal>> {
  const device = await access.findDevice(id, { signal: context.signal });
  if (device === undefined) {
    return err("auth.invalid");
  }
  if (device.revokedAtMs !== undefined) {
    return err("auth.revoked");
  }
  const challenge = challengeDevice({ access, device, origin: context.origin }, context.options);
  return ok({ kind: "challenge", challenge });
}

/**
 * Creates the sign-in check. A client token signs in over IPC only, by the SHA-256 of its secret,
 * with the scopes stored beside it; over WS it fails with `auth.local_only`. A console device signs
 * in over WS only, by signing a fresh nonce and the page's origin with its paired key. A Telegram
 * Mini App launch signs in over WS only, with the Mini App's scopes, when Telegram signed its
 * `initData` with the owner's bot token, its `auth_date` lies within 5 minutes of now, the owner's
 * numeric Telegram id opened it, and its hash has not signed in within 24 hours; a stale one is
 * `auth.expired`, any other `auth.invalid`, as is every launch without the owner's bot. An
 * unknown credential is `auth.invalid`, a revoked one `auth.revoked`, a token at or past its
 * expiry `auth.expired`.
 */
export function createSignIn(options: SignInOptions): SignIn {
  return {
    async start(request, signal) {
      const access = options.auth?.access;
      if (access === undefined) {
        return err("auth.required");
      }
      const { credential, transport, origin } = request;
      if ("token" in credential) {
        return transport === "ipc"
          ? signInWithToken(access, credential.token, { clock: options.clock, signal })
          : err("auth.local_only");
      }
      if (transport !== "ws") {
        return err("auth.invalid");
      }
      if ("device" in credential) {
        return origin === undefined
          ? err("auth.invalid")
          : signInWithDevice(access, credential.device, { origin, options, signal });
      }
      const miniApp = options.auth?.miniApp;
      return miniApp === undefined
        ? err("auth.invalid")
        : signInWithLaunch(miniApp, credential.telegram.initData, { options, signal });
    },
  };
}
