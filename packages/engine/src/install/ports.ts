import type { Result } from "@binference/core";
import type {
  CallsRefusal,
  CallsRequest,
  CeilingRead,
  CeilingRefusal,
  RecipientsRequest,
  SignedCeilingChange,
  SignedChangeRefusal,
  SignRecipientsRequest,
} from "./ceiling-change.js";
import type { ExportRefusal, ExportRequest, SealedKey } from "./wallet-export.js";
import type { MadeWallet, WalletRefusal, WalletRequest } from "./wallet-request.js";

/** What every call on custody's ceilings and wallet maker takes. */
interface CustodyCall {
  readonly signal: AbortSignal;
}

/**
 * Reads each agent wallet's ceiling, and changes it with the owner key (spec 5, section 4;
 * decisions 0110 and 0132): whom it lets a send pay, and what it lets a contract call do. Only a
 * ceiling's owner changes it. Adapter: the owner's Privy app, signed with the owner key. The key
 * comes with each request, serves it alone and is kept nowhere.
 */
export interface CeilingEditor {
  /** The ceiling as custody holds it now; `not_found` for one custody does not hold. */
  read(ceiling: string, options: CustodyCall): Promise<Result<CeilingRead, "not_found">>;
  /**
   * Sets each ceiling's recipients now, signed with the owner key: every send rule lists exactly
   * these accounts. Setting what a ceiling lists already changes nothing. A refusal changes no
   * ceiling it names.
   */
  setRecipients(
    request: RecipientsRequest,
    options: CustodyCall,
  ): Promise<Result<void, CeilingRefusal>>;
  /**
   * Signs now, with the owner key, a change of each ceiling's recipients from `from` to `to`, to
   * send with `sendSigned` before `untilMs`. It sends nothing.
   */
  signRecipients(
    request: SignRecipientsRequest,
    options: CustodyCall,
  ): Promise<Result<SignedCeilingChange, CeilingRefusal>>;
  /**
   * Sends a change signed ahead, while every ceiling still lists what it listed when the change
   * was signed, or the new recipients already; `changed` when one does not, so a change signed
   * earlier never undoes a later one. Sending it again changes nothing more.
   */
  sendSigned(
    change: SignedCeilingChange,
    options: CustodyCall,
  ): Promise<Result<void, SignedChangeRefusal>>;
  /**
   * Sets now, signed with the owner key, what a contract call may do under each ceiling on every
   * chain it enables: reach and approve exactly its venues' registry contracts, sending at most
   * its cap in native coin. The chains and recipients stay. Setting what a ceiling holds already
   * changes nothing. A code that is not the owner key changes nothing; a ceiling custody does not
   * hold, or venues that give one of its chains no contract, stops the change at that ceiling.
   */
  setCalls(request: CallsRequest, options: CustodyCall): Promise<Result<void, CallsRefusal>>;
}

/**
 * Makes agent wallets in custody (spec 5, section 2): each owned by the owner key, with this
 * machine's agent key as its one signer, under a ceiling of its own. Privy asks no signature to
 * make a wallet; the owner key's code is checked all the same before anything is made (decision
 * 0130). Adapter: the owner's Privy app. The key comes with each request and is kept nowhere.
 */
export interface WalletMaker {
  /**
   * Makes a wallet whose ceiling lets it call the venues' registry contracts on each enabled
   * chain, at the per-transaction cap, and send only to the recipients; reads it back, and signs
   * for it from then on. A refusal makes nothing. A wallet Privy reads back otherwise than asked
   * is a fault.
   */
  make(request: WalletRequest, options: CustodyCall): Promise<Result<MadeWallet, WalletRefusal>>;
}

/**
 * Exports an agent wallet's private key from custody sealed to a recipient key (spec 5, section
 * 6; decision 0131): custody encrypts the key with HPKE to the recipient's public key, so only the
 * process that holds its private half, the CLI, opens it. The owner key authorizes each export.
 * Adapter: the owner's Privy app. Neither the owner key nor the sealed key is kept.
 */
export interface WalletExporter {
  /**
   * The wallet's private key sealed to the request's recipient key, exported once. A refusal
   * exports nothing.
   */
  exportSealed(
    request: ExportRequest,
    options: CustodyCall,
  ): Promise<Result<SealedKey, ExportRefusal>>;
}
