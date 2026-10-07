import type { Brand, JsonValue } from "@binference/core";

/** An id Privy gives a wallet, a policy or a key quorum. */
export type PrivyId = Brand<string, "PrivyId">;

const privyIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

/** Whether a text can be a Privy id: URL-safe letters, digits, `_` and `-`, at most 128. */
export function isPrivyId(text: string): text is PrivyId {
  return privyIdPattern.test(text);
}

/** A key quorum as Privy reports it: the keys that may authorize for it, and how many must. */
export interface KeyQuorum {
  readonly id: PrivyId;
  /** P-256 public keys, DER SubjectPublicKeyInfo in base64 with no line breaks. */
  readonly publicKeys: readonly string[];
  /** How many members must sign; Privy may leave it out for a quorum of one. */
  readonly threshold: number | null;
  /** Privy users in the quorum; the quorums binference makes have none. */
  readonly userIds: readonly string[];
  /** Key quorums nested in this one; the quorums binference makes have none. */
  readonly memberQuorums: readonly string[];
}

/** A policy as Privy reports it. Its rules stay in Privy's JSON, for the read-back to compare. */
export interface PrivyPolicy {
  readonly id: PrivyId;
  readonly version: string;
  readonly chainType: string;
  /** The key quorum whose signatures change the policy; `null` lets the app secret alone. */
  readonly ownerId: PrivyId | null;
  readonly rules: readonly JsonValue[];
}

/** An added signer of a wallet, with the policy that binds it instead of the wallet's. */
export interface WalletSigner {
  readonly signerId: PrivyId;
  /** The override policies; `null` when Privy reports none. */
  readonly overridePolicyIds: readonly PrivyId[] | null;
}

/** A wallet as Privy reports it. */
export interface WalletRecord {
  readonly id: PrivyId;
  /** The wallet's address as Privy writes it. */
  readonly address: string;
  readonly chainType: string;
  /** The key quorum that owns the wallet; `null` when the app secret alone controls it. */
  readonly ownerId: PrivyId | null;
  readonly policyIds: readonly PrivyId[];
  readonly signers: readonly WalletSigner[];
}
