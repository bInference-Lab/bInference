import type { Id } from "@binference/core";
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

/** One transaction to sign, with the intent it belongs to and what approved that intent. */
export interface SignRequest {
  readonly wallet: Id<"wal">;
  readonly intent: Id<"int">;
  readonly authorization: SignAuthorization;
  /** The transaction its chain's family built; its `from` is the wallet's account. */
  readonly tx: UnsignedTx;
}
