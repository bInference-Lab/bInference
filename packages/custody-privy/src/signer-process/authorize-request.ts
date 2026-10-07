import type { AccountRef, SignAuthorization } from "@binference/chain";
import type { Id } from "@binference/core";
import type { PrivyRequest } from "./privy-request.js";

/**
 * The `authorize` request of the signer (spec 5, section 5.1): the Privy request to authorize and
 * what the signer checks it against with its hard rules (section 5.2).
 */
export interface AuthorizeRequest {
  readonly wallet: Id<"wal">;
  /** The exact request the signature covers. */
  readonly request: PrivyRequest;
  readonly intent: Id<"int">;
  /** The transaction's place in the intent's plan, from 0. */
  readonly step: number;
  readonly authorization: SignAuthorization;
  /** The SHA-256 in lowercase hex of the terms the authorization approved. */
  readonly termsHash: string;
  /** The registry's set for this step: the accounts the transaction may call or pay. */
  readonly allowed: readonly AccountRef[];
}

/** The signer's answer to `authorize`: Privy's authorization signature, DER in base64. */
export interface AuthorizationSignature {
  readonly signature: string;
}

/** The signer's answer to `publicKey`: the agent key's public half. */
export interface AgentPublicKey {
  /** DER SubjectPublicKeyInfo in base64, the form Privy's key quorums take. */
  readonly publicKey: string;
}
