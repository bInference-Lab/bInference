import { Buffer } from "node:buffer";
import { type Clock, err, ok, type Random, type Result } from "@binference/core";
import { type AccessStore, type DeviceRecord, sha256Hex } from "@binference/engine";
import type { Credential, ProtocolId, Scope } from "@binference/protocol";
import { isDeviceProofValid } from "./device-proof.js";
import type { Transport } from "./operation-handlers.js";

/** The credentials the server checks every sign-in against. */
export interface ServerAuth {
  /** Client tokens, by the SHA-256 of their secret, and paired console devices. */
  readonly access: AccessStore;
}

/** Why a sign-in fails; the connection ends with a `bye` of this code. */
type SignInRefusal = "auth.required" | "auth.invalid" | "auth.revoked" | "auth.local_only";

/** A credential that signed in: its id and the scopes it holds. */
export interface Identity {
  readonly credential: string;
  readonly scopes: readonly Scope[];
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

const nonceBytes = 32;

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
  await access.markTokenUsed({ id: record.id, atMs: options.clock.now() }, options);
  return ok({ kind: "signed_in", identity: { credential: record.id, scopes: record.scopes } });
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
 * Mini App launch fails with `auth.invalid` until the server is given a way to check it. An
 * unknown credential is `auth.invalid`, a revoked one `auth.revoked`.
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
      if ("device" in credential && transport === "ws" && origin !== undefined) {
        return signInWithDevice(access, credential.device, { origin, options, signal });
      }
      return err("auth.invalid");
    },
  };
}
