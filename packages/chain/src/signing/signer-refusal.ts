import { z } from "zod";

/**
 * Why the signer refused a request (keys spec, section 5): `unknown_request` for a message it
 * cannot read or a kind it does not know, `malformed` for a known kind that breaks its schema or a
 * Privy body it cannot read, and `rule_<n>` for the first hard rule of section 5.2 the request
 * breaks.
 */
export type SignerRefusal =
  | "unknown_request"
  | "malformed"
  | "rule_1"
  | "rule_2"
  | "rule_3"
  | "rule_4"
  | "rule_5"
  | "rule_6";

/**
 * Why a signer service whose key sits in a KMS refused a request (keys spec, section 8.3): a hard
 * rule of section 5.2 or `malformed`, as the signer process says them, or what only the service
 * reads from the install's rows. `unknown_wallet`: no wallet of the install signs for the step.
 * `intent_state`: the intent is not live and `executing`. `no_authorization` and
 * `authorization_ended`: nothing authorizes the step, or what did has run out. `terms_changed`:
 * the terms hash worked out again differs from the authorization's. `nonce_held`: another intent's
 * step that has not ended holds the nonce. `privy_refused`: Privy refused the request.
 */
export type SignerServiceRefusal =
  | Exclude<SignerRefusal, "unknown_request">
  | "unknown_wallet"
  | "intent_state"
  | "no_authorization"
  | "authorization_ended"
  | "terms_changed"
  | "nonce_held"
  | "privy_refused";

/** Parses a {@link SignerRefusal}. */
export const signerRefusalSchema: z.ZodType<SignerRefusal, SignerRefusal> = z.enum([
  "unknown_request",
  "malformed",
  "rule_1",
  "rule_2",
  "rule_3",
  "rule_4",
  "rule_5",
  "rule_6",
]);
