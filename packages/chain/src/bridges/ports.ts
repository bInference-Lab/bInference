import type { Result } from "@binference/core";
import type { TxDraft } from "../transaction.js";
import type { VenueDeclaration } from "../venues/venue.js";
import type {
  BridgeBuildRequest,
  BridgeDestination,
  BridgeQuote,
  BridgeQuoteRequest,
  DecodedDeposit,
  DepositRef,
  DepositStatus,
  NoBridgeRoute,
  SettlementCheck,
} from "./bridge-terms.js";

/**
 * A bridge: a venue that moves a token from the wallet's chain to an account on another chain
 * (decision 0067). It quotes a route, builds its deposit, decodes a deposit back from its bytes,
 * says where a deposit stands and matches a fill or refund to its deposit. It never signs, sends
 * or decides, and its word on a fill is only where to read: the destination chain's delivery
 * reader says whether the funds arrived, and the events it read say whose they were. It
 * declares its contracts and calls like any venue, so a ceiling holds its deposit's rules.
 * Adapters: bridge plugins, such as Across's.
 */
export interface Bridge extends VenueDeclaration {
  /** The chains it delivers to from the chains it declares, each once, with its id for each. */
  readonly destinations: readonly BridgeDestination[];
  /**
   * Quotes moving exactly the request's input. A route the bridge does not serve now, or a token
   * that leaves without a 24-hour cap, is `no_route`; an amount outside the route's limits or its
   * relayers' liquidity names which ({@link NoBridgeRoute}). A bridge that cannot answer throws.
   * The quote's least output is the bridge's word alone: the host floors it by its own price of
   * the input. Rejects with the signal's reason once the signal aborts.
   */
  quote(
    request: BridgeQuoteRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<BridgeQuote, NoBridgeRoute>>;
  /**
   * Builds the deposit's steps in order, each from the request's wallet: an exact token approval
   * when the bridge needs one, then the deposit. A quote given for another request, or a least
   * output above the quote's, is refused; a bridge that cannot build the quoted deposit throws.
   * Rejects with the signal's reason once the signal aborts.
   */
  build(
    request: BridgeBuildRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly TxDraft[]>;
  /**
   * Decodes a deposit the bridge builds, from the draft's bytes alone (decision 0317): `bound`
   * when the bytes name the recipient, the least output and the deadline, which the host compares
   * with the plan; `order` when they name only the depositor, the input and an order id, which the
   * host takes only from a bridge wallet. A draft that is not one of its deposits in the form it
   * builds, such as an approval, is `unknown_call`, never a guess.
   */
  decode(draft: TxDraft): Result<DecodedDeposit, "unknown_call">;
  /**
   * Where the deposit sent in this transaction stands, by the bridge's own word. A deposit the
   * bridge has not seen yet is `unseen`; a bridge that cannot answer throws. Rejects with the
   * signal's reason once the signal aborts.
   */
  status(deposit: DepositRef, options: { readonly signal: AbortSignal }): Promise<DepositStatus>;
  /**
   * The bridge's page for the deposit sent in this transaction, worked out without asking the
   * bridge: the owner's late notice names it when the bridge cannot say where the deposit stands.
   */
  pageOf(deposit: DepositRef): string;
  /**
   * What the settlement paid for this deposit by its own events (decision 0320), from the events
   * alone: for a fill, the base units its event says the recipient was paid in the delivered
   * token, from the deposit's own event on the destination's own contract, to the deposit's
   * recipient, in its token; for a refund, the base units it paid the depositor back of the token
   * sent, never more than the deposit. `not_own` when the events name another deposit, recipient
   * or token, or none of the bridge's own; a bare transfer is never its own.
   */
  settlement(check: SettlementCheck): Result<bigint, "not_own">;
}
