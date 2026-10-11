import { Buffer } from "node:buffer";
import { type Clock, err, ok, type Random, type Result, type Secret } from "@binference/core";
import { type AccessStore, type DeviceRecord, sha256Hex } from "@binference/engine";
import { launchTicketHash, type LaunchClaimOutcome } from "@binference/engine/access";
import type { Credential, ProtocolId, Scope, TelegramCredential } from "@binference/protocol";
import { isDeviceProofValid } from "./device-proof.js";
import type { Transport } from "./operation-handlers.js";
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

/** How one sign-in runs: its signal, and where it names the credential it checks. */
interface SignInCall {
  readonly signal: AbortSignal;
  /**
   * Hears the id of the credential the `open` claims as soon as the check knows it, before any
   * store read or write, so a revoke of that credential during the sign-in can end the connection.
   */
  readonly claim: (credential: string) => void;
}

/** Checks the credential of each `open`. */
export interface SignIn {
  start(request: SignInRequest, call: SignInCall): Promise<Result<SignInStep, SignInRefusal>>;
}

/** What a {@link SignIn} reads. Without `auth`, every sign-in fails with `auth.required`. */
export interface SignInOptions {
  readonly auth?: ServerAuth;
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

/** How long a Mini App connection lasts after it signed in (decision 0161). */
const miniAppSessionMs: number = 12 * 60 * 60_000;

/** How long a launch that signed in is refused if it comes again (protocol spec, section 4.2). */
const launchRetentionMs: number = 24 * 60 * 60_000;

const nonceBytes = 32;

const launchRefusals: Readonly<Record<TelegramLaunchRefusal, SignInRefusal>> = {
  malformed: "auth.invalid",
  forged: "auth.invalid",
  stale: "auth.expired",
};

const claimRefusals: Readonly<Record<Exclude<LaunchClaimOutcome, "claimed">, SignInRefusal>> = {
  seen: "auth.invalid",
  no_ticket: "auth.invalid",
  ticket_expired: "auth.expired",
};

/**
 * The credential id of a Mini App connection: the owner's Telegram id, as the owner's chat names
 * the owner in journals and ledger entries.
 */
export function telegramCredentialOf(userId: number): string {
  return `tg:${String(userId)}`;
}

// A launch signs in when Telegram signed it with the owner's bot token, its `auth_date` is fresh,
// the owner opened it, it never signed in before, and it brings a live launch ticket `/console`
// made for the owner. The hash is claimed last, after the owner check, in one write to
// `engine.sqlite` that also spends the ticket and forgets the claims older than the retention, so
// two connections with the same launch or ticket never both pass, even across a restart. The
// owner is read again after that write: a new owner bound meanwhile refuses the old one's launch.
async function signInWithLaunch(
  auth: { readonly access: AccessStore; readonly miniApp: MiniAppAuth },
  telegram: TelegramCredential["telegram"],
  context: { readonly clock: Clock; readonly call: SignInCall },
): Promise<Result<SignInStep, SignInRefusal>> {
  const { access, miniApp } = auth;
  const { clock, call } = context;
  const { signal } = call;
  const { initData, ticket } = telegram;
  const launch = checkTelegramLaunch({
    initData,
    botToken: miniApp.botToken,
    nowMs: clock.now(),
    maxAgeMs: launchMaxAgeMs,
  });
  if (!launch.ok) {
    return err(launchRefusals[launch.error]);
  }
  const credential = telegramCredentialOf(launch.value.userId);
  call.claim(credential);
  if (ticket === undefined) {
    return err("auth.invalid");
  }
  const ownerId = await miniApp.ownerId({ signal });
  if (ownerId === undefined || ownerId !== launch.value.userId) {
    return err("auth.invalid");
  }
  const atMs = clock.now();
  const sinceMs = Math.max(0, atMs - launchRetentionMs + 1);
  const launchHash = sha256Hex(launch.value.hash);
  const claim = {
    launchHash,
    ticketHash: launchTicketHash(ticket),
    userId: ownerId,
    atMs,
    sinceMs,
  };
  const claimed = await access.claimLaunch(claim, { signal });
  if (claimed !== "claimed") {
    return err(claimRefusals[claimed]);
  }
  if ((await miniApp.ownerId({ signal })) !== ownerId) {
    return err("auth.revoked");
  }
  const identity = { credential, scopes: miniAppScopes, expiresAtMs: atMs + miniAppSessionMs };
  return ok({ kind: "signed_in", identity });
}

// The record the store answers a sign-in's write with is the one that counts: a revoke stored
// before that write refuses the sign-in, and one stored after it finds the connection by the
// credential it claimed.
function stillLive<T extends { readonly revokedAtMs?: number }>(
  written: Result<T, "not_found">,
): Result<T, SignInRefusal> {
  if (!written.ok) {
    return err("auth.invalid");
  }
  return written.value.revokedAtMs === undefined ? written : err("auth.revoked");
}

async function signInWithToken(
  access: AccessStore,
  token: string,
  context: { readonly clock: Clock; readonly call: SignInCall },
): Promise<Result<SignInStep, SignInRefusal>> {
  const { clock, call } = context;
  const record = await access.findToken(sha256Hex(token), { signal: call.signal });
  if (record === undefined) {
    return err("auth.invalid");
  }
  call.claim(record.id);
  if (record.revokedAtMs !== undefined) {
    return err("auth.revoked");
  }
  const nowMs = clock.now();
  if (record.expiresAtMs !== undefined && nowMs >= record.expiresAtMs) {
    return err("auth.expired");
  }
  const used = stillLive(
    await access.markTokenUsed({ id: record.id, atMs: nowMs }, { signal: call.signal }),
  );
  if (!used.ok) {
    return used;
  }
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
      const marked = stillLive(await start.access.markDeviceSeen(seen, { signal }));
      return marked.ok ? ok({ credential: start.device.id, scopes: consoleDeviceScopes }) : marked;
    },
  };
}

async function signInWithDevice(
  access: AccessStore,
  id: ProtocolId<"consoleDevice">,
  context: {
    readonly origin: string;
    readonly options: SignInOptions;
    readonly call: SignInCall;
  },
): Promise<Result<SignInStep, SignInRefusal>> {
  context.call.claim(id);
  const device = await access.findDevice(id, { signal: context.call.signal });
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
 * numeric Telegram id opened it, its hash has not signed in within 24 hours, as `engine.sqlite`
 * keeps them across restarts, and it brings a live launch ticket `/console` made for the owner,
 * which it spends; its connection ends 12 hours later. A stale launch or an expired ticket is
 * `auth.expired`, any other refusal `auth.invalid`, as is every launch without the owner's bot. An
 * unknown credential is `auth.invalid`, a revoked one `auth.revoked`, a token at or past its
 * expiry `auth.expired`. A revoke, or a new owner, stored before the sign-in's last write refuses
 * it with `auth.revoked`; `call.claim` hears the credential first, so one stored later can end
 * the connection.
 */
export function createSignIn(options: SignInOptions): SignIn {
  return {
    async start(request, call) {
      const access = options.auth?.access;
      if (access === undefined) {
        return err("auth.required");
      }
      const { credential, transport, origin } = request;
      if ("token" in credential) {
        return transport === "ipc"
          ? signInWithToken(access, credential.token, { clock: options.clock, call })
          : err("auth.local_only");
      }
      if (transport !== "ws") {
        return err("auth.invalid");
      }
      if ("device" in credential) {
        return origin === undefined
          ? err("auth.invalid")
          : signInWithDevice(access, credential.device, { origin, options, call });
      }
      const miniApp = options.auth?.miniApp;
      return miniApp === undefined
        ? err("auth.invalid")
        : signInWithLaunch({ access, miniApp }, credential.telegram, {
            clock: options.clock,
            call,
          });
    },
  };
}
