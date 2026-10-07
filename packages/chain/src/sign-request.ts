import type { Id } from "@binference/core";
import type { AccountRef } from "./caip/account-ref.js";
import type { UnsignedTx } from "./transaction.js";

/**
 * What approved the intent a transaction belongs to, as the hard rules check it (spec 5, section
 * 5.2): the owner's confirmation of its card, an auto order or a webhook rule the owner confirmed
 * in advance, or the agent's auto mode at one version.
 */
export type SignAuthorization =
  | { readonly confirmation: Id<"cnf"> }
  | { readonly order: Id<"ord"> }
  | { readonly webhookRule: Id<"whr"> }
  | { readonly approvalMode: "auto"; readonly modeVersion: number };

/**
 * One transaction to sign, with the intent it belongs to and what approved that intent. The
 * custody adapter passes the step, the terms hash and the allowed set to the signer, which checks
 * the transaction against them before it authorizes anything (spec 5, sections 5.1 and 5.2).
 */
export interface SignRequest {
  readonly wallet: Id<"wal">;
  readonly intent: Id<"int">;
  /** The transaction's place in the intent's plan, from 0: an approval comes before its trade. */
  readonly step: number;
  readonly authorization: SignAuthorization;
  /** The SHA-256 in lowercase hex of the terms the authorization approved. */
  readonly termsHash: string;
  /**
   * The accounts this step may call or pay: the venue's registry contracts, the token of an exact
   * approval to a registry spender, or the confirmed recipient of a send, bridge or rescue.
   */
  readonly allowed: readonly AccountRef[];
  /** The transaction its chain's family built; its `from` is the wallet's account. */
  readonly tx: UnsignedTx;
}
