import type { PrivyRequest } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import { callAsOwner, ownerSignFn } from "../privy/owner-signing.js";
import { type PrivyCall, type PrivyOutcome, statusFault } from "../privy/privy-call.js";
import { type PrivyApiOptions, type PrivySettings, privySettings } from "../privy/privy-client.js";
import type { PrivyId } from "../privy/privy-records.js";
import { refusalOf } from "../privy/privy-wire.schema.js";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";

/**
 * What became of one leftover the sweep asked Privy to remove: removed now, already gone, or kept
 * because Privy refused, such as a policy a wallet still holds or a key quorum that still owns a
 * wallet.
 */
type RemovalOutcome = "removed" | "gone" | "kept";

/** Who signs one removal as the owner of what it removes, and the signal that stops it. */
interface OwnerCall {
  readonly authorize: OwnerAuthorize;
  readonly signal: AbortSignal;
}

/**
 * The removals of leftovers on a Privy test app, which binference's runtime never sends: each
 * signed now by the key quorum that owns the thing, through Privy's official Node SDK, sent once
 * within the call's timeout. A busy app, refused credentials or a failing Privy throw.
 */
export interface LeftoverRemovals {
  /**
   * Takes every policy off a wallet: its own policy and its added signers, whose overrides would
   * still hold a policy. Signed by the wallet's owner.
   */
  detachPolicies(wallet: PrivyId, call: OwnerCall): Promise<RemovalOutcome>;
  /** Deletes a policy no wallet holds any more, signed by its owner. */
  deletePolicy(policy: PrivyId, call: OwnerCall): Promise<RemovalOutcome>;
  /** Deletes a key quorum that owns and signs for nothing, signed by the quorum itself. */
  deleteKeyQuorum(quorum: PrivyId, call: OwnerCall): Promise<RemovalOutcome>;
}

// How long a removal stays valid on Privy once the owner signs it.
const removalLifetimeMs = 5 * 60_000;

interface Removal {
  readonly method: "PATCH" | "DELETE";
  readonly path: string;
  readonly body: Readonly<Record<string, JsonValue>>;
  readonly run: (
    client: PrivyClient,
    sent: {
      readonly request_expiry: number;
      readonly sign: (payload: Uint8Array) => Promise<string>;
    },
  ) => Promise<object>;
}

// Privy's refusals of a removal: a 404 is gone; a refused signature or any refusal of the request
// itself keeps the thing; a busy app, refused credentials and a failure are faults.
function outcomeOf(
  call: PrivyCall<object>,
  outcome: PrivyOutcome<object> | "refused",
): RemovalOutcome {
  if (outcome === "refused") {
    return "kept";
  }
  if (outcome.ok) {
    return "removed";
  }
  const { status } = outcome;
  if (status === 404) {
    return "gone";
  }
  const isRequestRefusal = status >= 400 && status < 500 && ![401, 403, 429].includes(status);
  if (isRequestRefusal || refusalOf(outcome.code) === "authorization") {
    return "kept";
  }
  throw statusFault(call, outcome);
}

async function remove(
  settings: PrivySettings,
  removal: Removal,
  owner: OwnerCall,
): Promise<RemovalOutcome> {
  const expiresAtMs = settings.clock.now() + removalLifetimeMs;
  const meant: PrivyRequest = {
    method: removal.method,
    url: `${settings.origin}${removal.path}`,
    headers: { "privy-app-id": settings.appId, "privy-request-expiry": String(expiresAtMs) },
    body: removal.body,
  };
  const call: PrivyCall<object> = {
    kind: "write",
    path: removal.path,
    run: async (client, signal) =>
      removal.run(client, {
        request_expiry: expiresAtMs,
        sign: ownerSignFn({ meant, authorize: owner.authorize, signal }),
      }),
  };
  return outcomeOf(call, await callAsOwner(settings, call, owner.signal));
}

// A delete of what the owner holds, with the empty body Privy's SDK sends and signs.
function deletion(path: string, run: Removal["run"]): Removal {
  return { method: "DELETE", path, body: {}, run };
}

/** Creates the {@link LeftoverRemovals} of a Privy test app. */
export function createLeftoverRemovals(options: PrivyApiOptions): LeftoverRemovals {
  const settings = privySettings(options);
  return {
    detachPolicies: async (wallet, owner) =>
      remove(
        settings,
        {
          method: "PATCH",
          path: `/v1/wallets/${wallet}`,
          body: { policy_ids: [], additional_signers: [] },
          run: async (client, { request_expiry, sign }) =>
            client.wallets().update(wallet, {
              policy_ids: [],
              additional_signers: [],
              request_expiry,
              authorization_context: { sign_fns: [sign] },
            }),
        },
        owner,
      ),
    deletePolicy: async (policy, owner) =>
      remove(
        settings,
        deletion(`/v1/policies/${policy}`, async (client, { request_expiry, sign }) =>
          client
            .policies()
            .delete(policy, { request_expiry, authorization_context: { sign_fns: [sign] } }),
        ),
        owner,
      ),
    deleteKeyQuorum: async (quorum, owner) =>
      remove(
        settings,
        deletion(`/v1/key_quorums/${quorum}`, async (client, { request_expiry, sign }) =>
          client
            .keyQuorums()
            .delete(quorum, { request_expiry, authorization_context: { sign_fns: [sign] } }),
        ),
        owner,
      ),
  };
}
