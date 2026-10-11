import type { Secret } from "@binference/core";

/** A machine's agent key to remove from the wallets' signers, with the owner key. */
export interface SignerRevocation {
  /** Custody's id of the signer: the key quorum that holds the machine's agent key. */
  readonly signer: string;
  /** The wallets as custody names them: each wallet record's `custodyWalletId`. */
  readonly wallets: readonly string[];
  /** The owner key code as the owner typed it; custody uses it for this request only. */
  readonly ownerKey: Secret;
}

/**
 * Why custody removed no signer, or stopped part way: the code is not the key that owns the
 * wallets, custody holds one of the wallets no more, no wallet lists the signer, a wallet lists it
 * alone and would keep no signer, or custody read a change after its expiry.
 */
export type RevokeRefusal =
  | "bad_owner_key"
  | "not_found"
  | "not_signer"
  | "last_signer"
  | "expired";
