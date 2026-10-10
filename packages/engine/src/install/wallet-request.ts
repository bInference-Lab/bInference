import type { AccountRef } from "@binference/chain";
import type { Id, Secret } from "@binference/core";
import type { WalletDraft } from "./install-record.js";

/** What a new agent wallet is made with (spec 5, section 2; decision 0130). */
export interface WalletRequest {
  /** The id the engine gives the wallet: custody signs for it under this id once it is made. */
  readonly wallet: Id<"wal">;
  /** The owner key code as the owner typed it; custody uses it for this request only. */
  readonly ownerKey: Secret;
  /** The venues whose registry contracts the new ceiling lets the wallet call. */
  readonly venues: readonly string[];
  /** Every account a send from the wallet may pay: the rescue address and the saved addresses. */
  readonly recipients: readonly AccountRef[];
}

/** A wallet custody made and read back. */
export interface MadeWallet {
  /** The wallet as the install store keeps it, but for the engine's own fields. */
  readonly record: Pick<
    WalletDraft,
    "family" | "custody" | "custodyWalletId" | "policyId" | "signerId" | "address" | "ceiling"
  >;
  /** Its account on the first chain its ceiling enables, which custody signs for from now on. */
  readonly account: AccountRef;
}

/**
 * Why custody made no wallet: the code is not the install's owner key, or the recipients are more
 * than a ceiling can list.
 */
export type WalletRefusal = "bad_owner_key" | "bad_recipients";
