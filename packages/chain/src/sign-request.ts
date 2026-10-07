import type { Id } from "@binference/core";
import type { AuthorizeInput } from "./signing/authorize-input.js";
import type { UnsignedTx } from "./transaction.js";

/**
 * One transaction to sign, with the intent it belongs to and what approved that intent. The
 * custody adapter passes the step, the authorization, the terms hash and the allowed set on to the
 * signer in its `authorize` request ({@link AuthorizeInput}), which checks the transaction against
 * them before it authorizes anything (spec 5, sections 5.1 and 5.2).
 */
export interface SignRequest extends Pick<
  AuthorizeInput,
  "intent" | "step" | "authorization" | "termsHash" | "allowed"
> {
  readonly wallet: Id<"wal">;
  /** The transaction its chain's family built; its `from` is the wallet's account. */
  readonly tx: UnsignedTx;
}
