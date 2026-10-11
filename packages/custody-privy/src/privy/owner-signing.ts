import { authorizationPayload, type PrivyRequest } from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import {
  callPrivy,
  type PrivyCall,
  type PrivyOutcome,
  privyFault,
  statusFault,
} from "./privy-call.js";
import type { PrivySettings } from "./privy-client.js";
import { refusalOf } from "./privy-wire.schema.js";

/** Signs a request as the owner key, or refuses; a refusal stops the call before Privy hears it. */
type OwnerSign = (request: PrivyRequest, signal: AbortSignal) => Promise<Result<string, "refused">>;

// Never leaves this file: a refusal of the owner stops the SDK before it sends anything.
const ownerRefused = "custody.owner_refused";

/** One request the owner means to sign, and who signs it. */
export interface OwnerSigning {
  /** The request as this adapter forms it; the SDK must ask to sign exactly its bytes. */
  readonly meant: PrivyRequest;
  readonly authorize: OwnerSign;
  readonly signal: AbortSignal;
}

/**
 * The SDK's sign function for one request the owner means: the owner signs only when the bytes
 * the SDK asks for are `authorizationPayload` of that request, so the owner never signs a request
 * this adapter did not form. Another payload throws `custody.payload_unreadable`.
 */
export function ownerSignFn(signing: OwnerSigning): (payload: Uint8Array) => Promise<string> {
  return async (payload) => {
    if (!authorizationPayload(signing.meant).equals(payload)) {
      throw new BinferenceError({
        code: "custody.payload_unreadable",
        message: "The SDK asked the owner to sign a request other than the one this adapter sends.",
      });
    }
    const answer = await signing.authorize(signing.meant, signing.signal);
    if (!answer.ok) {
      throw new BinferenceError({ code: ownerRefused, message: "The owner refused." });
    }
    return answer.value;
  };
}

/**
 * Runs a call whose request the owner signs through {@link ownerSignFn}. Answers `refused` when
 * the owner refused, so Privy heard nothing; otherwise the call's outcome.
 */
export async function callAsOwner<T>(
  settings: PrivySettings,
  call: PrivyCall<T>,
  signal: AbortSignal,
): Promise<PrivyOutcome<T> | "refused"> {
  try {
    return await callPrivy(settings, call, signal);
  } catch (error) {
    if (error instanceof BinferenceError && error.code === ownerRefused) {
      return "refused";
    }
    throw error;
  }
}

/** Why Privy did not make a change its owner signs. */
export type OwnerRefusal =
  /** The owner did not sign, or Privy did not take the signature as the owner's. */
  | "refused"
  /** The request's expiry had passed when Privy read it. */
  | "expired"
  /** Privy holds no such resource. */
  | "not_found";

/**
 * What a call {@link callAsOwner} ran gives: the answer `read` reads, or Privy's documented
 * refusals as outcomes, a missing or wrong owner signature `refused`, a passed expiry `expired`,
 * an unknown resource `not_found`. An answer `read` cannot read is malformed; any other status is
 * a fault.
 */
export async function ownerOutcome<A, T>(
  call: PrivyCall<A>,
  outcome: PrivyOutcome<A> | "refused",
  read: (answer: A) => T | undefined,
): Promise<Result<T, OwnerRefusal>> {
  if (outcome === "refused") {
    return err("refused");
  }
  if (outcome.ok) {
    const value = read(outcome.value);
    return value === undefined
      ? Promise.reject(privyFault("custody.privy_malformed", call))
      : ok(value);
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
