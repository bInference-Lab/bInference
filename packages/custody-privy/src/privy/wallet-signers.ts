import type { PrivyRequest } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import type { Wallet } from "@privy-io/node/resources";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";
import { callAsOwner, ownerSignFn } from "./owner-signing.js";
import { type PrivyCall, privyFault, statusFault } from "./privy-call.js";
import type { PrivySettings } from "./privy-client.js";
import type { PrivyId, WalletRecord } from "./privy-records.js";
import { readWallet, refusalOf } from "./privy-wire.schema.js";

/** An added signer of a wallet: a key quorum, bound to these policies instead of the wallet's. */
export interface SignerEntry {
  readonly signer: PrivyId;
  /** The override policies; none leaves the signer bound to the wallet's own. */
  readonly policies: readonly PrivyId[];
}

/** The added signers a wallet is to have, in place of the ones it has. */
export interface SignersChange {
  readonly wallet: PrivyId;
  readonly signers: readonly SignerEntry[];
  /** Unix milliseconds; Privy refuses the change once this has passed. */
  readonly expiresAtMs: number;
}

/** Why Privy did not change a wallet's signers. */
export type SignersRefusal =
  /** The owner did not sign, or Privy did not take the signature as the wallet owner's. */
  | "refused"
  /** The request's expiry had passed when Privy read it. */
  | "expired"
  /** Privy holds no such wallet. */
  | "not_found";

function bodyOf(change: SignersChange) {
  return {
    additional_signers: change.signers.map((entry) => ({
      signer_id: entry.signer,
      ...(entry.policies.length === 0 ? {} : { override_policy_ids: [...entry.policies] }),
    })),
  };
}

/**
 * The request a change of a wallet's signers sends, as its authorization signature covers it: a
 * `PATCH` of the wallet with its added signers alone, and the app id and expiry headers. Privy's
 * SDK forms the same request, so the owner signs exactly what Privy reads.
 */
function signersChangeRequest(settings: PrivySettings, change: SignersChange): PrivyRequest {
  return {
    method: "PATCH",
    url: `${settings.origin}/v1/wallets/${change.wallet}`,
    headers: {
      "privy-app-id": settings.appId,
      "privy-request-expiry": String(change.expiresAtMs),
    },
    body: bodyOf(change),
  };
}

function updateCall(
  settings: PrivySettings,
  change: SignersChange,
  authorize: OwnerAuthorize,
): PrivyCall<Wallet> {
  return {
    kind: "write",
    path: `/v1/wallets/${change.wallet}`,
    run: async (client: PrivyClient, signal: AbortSignal) =>
      client.wallets().update(change.wallet, {
        ...bodyOf(change),
        request_expiry: change.expiresAtMs,
        authorization_context: {
          sign_fns: [
            ownerSignFn({ meant: signersChangeRequest(settings, change), authorize, signal }),
          ],
        },
      }),
  };
}

/**
 * Sets a wallet's added signers, once, signed now by the wallet's owner (Privy's wallet update):
 * the signers given replace every one it had. Answers the wallet as Privy reports it after the
 * change. A missing or wrong owner signature is `refused`, a passed expiry `expired`, an unknown
 * wallet `not_found`. A busy app, bad credentials, a refused body or a failing Privy throw, and a
 * call with no answer throws `custody.privy_unreachable`, whose outcome is unknown; setting the
 * same signers again is safe.
 */
export async function setWalletSigners(
  settings: PrivySettings,
  change: SignersChange,
  input: { readonly authorize: OwnerAuthorize; readonly signal: AbortSignal },
): Promise<Result<WalletRecord, SignersRefusal>> {
  const call = updateCall(settings, change, input.authorize);
  const outcome = await callAsOwner(settings, call, input.signal);
  if (outcome === "refused") {
    return err("refused");
  }
  if (outcome.ok) {
    const wallet = readWallet(outcome.value);
    return wallet === undefined
      ? Promise.reject(privyFault("custody.privy_malformed", call))
      : ok(wallet);
  }
  const refusal = refusalOf(outcome.code);
  if (refusal === "authorization") {
    return err("refused");
  }
  if (refusal === "expired") {
    return err("expired");
  }
  return outcome.status === 404 ? err("not_found") : Promise.reject(statusFault(call, outcome));
}
