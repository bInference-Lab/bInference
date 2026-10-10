import { authorizationPayload, type PrivyRequest } from "@binference/chain";
import { BinferenceError, type Result } from "@binference/core";
import { callPrivy, type PrivyCall, type PrivyOutcome } from "./privy-call.js";
import type { PrivySettings } from "./privy-client.js";

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
