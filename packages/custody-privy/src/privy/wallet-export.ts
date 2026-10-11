import type { PrivyRequest } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import { z } from "zod";
import { callPrivy, type PrivyCall, privyFault, statusFault } from "./privy-call.js";
import type { PrivySettings } from "./privy-client.js";
import type { PrivyId } from "./privy-records.js";
import { refusalOf } from "./privy-wire.schema.js";

/** An export of one wallet's private key, sealed to a recipient key and signed by its owner. */
export interface WalletExportRequest {
  readonly wallet: PrivyId;
  /**
   * The HPKE recipient key the private key is sealed to: a P-256 public key as DER
   * SubjectPublicKeyInfo in base64, as Privy's export docs make it.
   */
  readonly recipientPublicKey: string;
  /** Signs the exact request as the wallet's owner, or refuses; a refusal sends nothing. */
  readonly authorize: (
    request: PrivyRequest,
    signal: AbortSignal,
  ) => Promise<Result<string, "refused">>;
  /** Unix milliseconds; Privy refuses the export once this has passed. */
  readonly expiresAtMs: number;
}

/**
 * A wallet's private key as Privy sealed it with HPKE (DHKEM P-256, HKDF-SHA256,
 * ChaCha20-Poly1305, base mode): only the recipient key's private half opens it. Both in base64.
 */
export interface SealedWalletKey {
  readonly ciphertext: string;
  readonly encapsulatedKey: string;
}

/** Why Privy exported no key. */
export type WalletExportRefusal =
  /** The owner did not sign, or Privy did not take the signature as the wallet owner's. */
  | "refused"
  /** Privy holds no such wallet. */
  | "not_found"
  /** Privy refused the request's body: the recipient key is no key it can seal to. */
  | "bad_recipient_key";

const sealedWire = z.object({
  encryption_type: z.literal("HPKE"),
  ciphertext: z.base64().min(1).max(4096),
  encapsulated_key: z.base64().min(1).max(512),
});

function bodyOf(request: WalletExportRequest) {
  return {
    encryption_type: "HPKE" as const,
    recipient_public_key: request.recipientPublicKey,
    export_seed_phrase: false,
  };
}

/**
 * The request an export sends, as its authorization signature covers it: a `POST` of the wallet's
 * export with the HPKE recipient key and no seed phrase, and the app id and expiry headers. The
 * SDK sends the same request, so a signature made over this one holds.
 */
function walletExportRequest(settings: PrivySettings, request: WalletExportRequest): PrivyRequest {
  return {
    method: "POST",
    url: `${settings.origin}/v1/wallets/${request.wallet}/export`,
    headers: {
      "privy-app-id": settings.appId,
      "privy-request-expiry": String(request.expiresAtMs),
    },
    body: bodyOf(request),
  };
}

function exportCall(
  request: WalletExportRequest,
  signature: string,
): PrivyCall<z.infer<typeof sealedWire> | undefined> {
  return {
    kind: "write",
    path: `/v1/wallets/${request.wallet}/export`,
    run: async (client: PrivyClient) => {
      // oxlint-disable-next-line eslint/no-underscore-dangle -- the SDK's call of the REST export: its exportPrivateKey opens the key in this process, which decision 0131 forbids
      const answer = await client.wallets()._export(request.wallet, {
        ...bodyOf(request),
        "privy-authorization-signature": signature,
        "privy-request-expiry": String(request.expiresAtMs),
      });
      const read = sealedWire.safeParse(answer);
      return read.success ? read.data : undefined;
    },
  };
}

/**
 * Asks Privy, once, for a wallet's private key sealed with HPKE to the recipient key, signed now
 * by the wallet's owner (Privy's export API). Privy never answers the key in the clear; nothing
 * here can open the sealed key. A missing or wrong owner signature is `refused`, an unknown
 * wallet `not_found`, a body Privy refuses `bad_recipient_key`. A passed expiry, a busy app, bad
 * credentials or a failing Privy throw, and so does an answer of another shape.
 */
export async function exportWallet(
  settings: PrivySettings,
  request: WalletExportRequest,
  signal: AbortSignal,
): Promise<Result<SealedWalletKey, WalletExportRefusal>> {
  const signature = await request.authorize(walletExportRequest(settings, request), signal);
  if (!signature.ok) {
    return signature;
  }
  const call = exportCall(request, signature.value);
  const outcome = await callPrivy(settings, call, signal);
  if (outcome.ok) {
    const sealed = outcome.value;
    if (sealed === undefined) {
      throw privyFault("custody.privy_malformed", call);
    }
    return ok({ ciphertext: sealed.ciphertext, encapsulatedKey: sealed.encapsulated_key });
  }
  const refusal = refusalOf(outcome.code);
  if (refusal === "authorization") {
    return err("refused");
  }
  if (refusal === "expired") {
    throw privyFault("custody.request_expired", call, outcome);
  }
  if (outcome.status === 404) {
    return err("not_found");
  }
  return outcome.status === 400
    ? err("bad_recipient_key")
    : Promise.reject(statusFault(call, outcome));
}
