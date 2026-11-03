import type { Result } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { SimulatedStep } from "../simulation/simulated-step.js";
import type { TxDraft, TxHash } from "../transaction.js";
import type { VenueDeclaration } from "../venues/venue.js";
import type {
  DecodedRegistration,
  IdentityStanding,
  LandedRegistration,
  RegistrationCard,
} from "./registration.js";

/**
 * An agent identity registry on one chain (decision 0335): it writes an agent's registration file,
 * reads whether a wallet holds an identity already and which version the registry runs, builds the
 * one call that registers a file and mints the identity token to the wallet that signs, decodes
 * only that call, counts the identity tokens a simulated step minted to a wallet, and reads back
 * what a landed registration made. It never signs, sends or decides. It declares its contract and
 * call like any venue, so a ceiling holds their rules. Adapters: identity plugins, such as the
 * ERC-8004 one.
 */
export interface IdentityRegistry extends VenueDeclaration {
  /** The chain the registry runs on. */
  readonly chain: ChainRef;
  /** The registry's own account on that chain. */
  readonly registry: AccountRef;
  /**
   * The registry version the plugin was tested with: the engine registers only while the registry
   * reports it.
   */
  readonly testedVersion: string;
  /**
   * The contract an upgradeable registry's proxy ran when the plugin was tested, as the chain
   * registry pins it: the engine registers only while the proxy runs it, since an upgrade could
   * change what a registration does and still report the same version. Absent for a registry
   * that cannot be upgraded.
   */
  readonly testedImplementation?: AccountRef;
  /**
   * The registration file of the card, as the registry stores it: the same card gives the same
   * file, and every field of the card is in it. A wallet of another chain is a fault.
   */
  fileOf(card: RegistrationCard): string;
  /**
   * The registry's version, how many of its identity tokens the wallet holds, and the contract its
   * proxy runs, at one latest block. A registry that cannot be read throws. Rejects with the signal's reason once the
   * signal aborts.
   */
  standing(
    wallet: AccountRef,
    options: { readonly signal: AbortSignal },
  ): Promise<IdentityStanding>;
  /**
   * The one call that registers the file from the wallet, sending no coin, whose identity token
   * the registry mints to that wallet. A wallet of another chain is a fault.
   */
  build(request: { readonly wallet: AccountRef; readonly file: string }): TxDraft;
  /**
   * The file a registration call registers, from the draft's bytes alone. A call to another
   * contract, of another function, in another form than `build` makes, or sending coin, is
   * `unknown_call`, never a guess.
   */
  decode(draft: TxDraft): Result<DecodedRegistration, "unknown_call">;
  /** How many identity tokens of the registry the simulated step minted to the wallet. */
  minted(step: SimulatedStep, wallet: AccountRef): number;
  /**
   * What the transaction's registration from the wallet made, read from its own events and the
   * registry now: a transaction that holds none, such as a revert, is `not_found`. A registry or
   * a transaction that cannot be read throws. Rejects with the signal's reason once the signal
   * aborts.
   */
  landed(
    request: { readonly wallet: AccountRef; readonly txHash: TxHash },
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LandedRegistration, "not_found">>;
}
