import type { Id, Ratio, Result } from "@binference/core";
import type { AccountRef } from "./caip/account-ref.js";
import type { AssetRef } from "./caip/asset-ref.js";
import type { ChainRef } from "./caip/chain-ref.js";
import type { DraftCall } from "./draft-call.js";
import type { RegisteredChain } from "./registry/registered-chain.js";
import type { SignRequest } from "./sign-request.js";
import type { SignatureProblem, SignedTx, TxDraft, TxHash, UnsignedTx } from "./transaction.js";

/**
 * What a chain family does for the chain-neutral core. A family package (EVM now, Solana later)
 * implements it; the core never names a family.
 */
export interface ChainFamily {
  /** The family's registry id, which chain definitions name. */
  readonly id: string;
  /** The CAIP-2 namespace of the family's chains. */
  readonly namespace: string;
  /**
   * Parses an address as a person or a venue wrote it into the family's canonical form, which
   * compares equal for one account. Malformed text is an expected failure, never a throw.
   */
  parseAddress(text: string): Result<string, "malformed_address">;
  /**
   * Reads where a draft calls, the native coin it sends and the token approval it grants, from the
   * draft's bytes alone. A draft of another family, or bytes it cannot read, is an expected
   * failure: the venue host refuses what the family cannot read.
   */
  readDraft(draft: TxDraft): Result<DraftCall, "malformed_draft">;
}

/**
 * How a family's transactions are signed. The engine never trusts a signature blindly: it checks
 * that the signed transaction is the unsigned one, signed by its sender, before storing it.
 */
export interface SigningScheme {
  /** The id of the family whose transactions it checks. */
  readonly family: string;
  /** Checks a signed transaction against the unsigned one and gives its hash on chain. */
  verify(unsigned: UnsignedTx, signed: SignedTx): Result<TxHash, SignatureProblem>;
}

/**
 * Signs for the agent wallets (ARCHITECTURE.md section 8). No machine running binference holds a
 * wallet's private key: a custodian keeps it and signs only inside the wallet's ceiling. Adapters:
 * `privy-owner` in `@binference/custody-privy` (the owner's Privy app, with the agent key in the
 * signer process) and `privy-service` (a signer service whose authorization key sits in a KMS).
 */
export interface Signer {
  /** The wallet's account on a chain; `unknown_wallet` when the wallet has none there. */
  account(
    wallet: Id<"wal">,
    chain: ChainRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<AccountRef, "unknown_wallet">>;
  /**
   * Signs one transaction of an approved intent. `unknown_wallet` when the custodian holds no
   * such wallet; `refused` when it will not sign this one: its sender is not the wallet, it falls
   * outside the ceiling, or the owner removed this signer from the wallet. Rejects with the
   * signal's reason once the signal aborts, and signs nothing.
   */
  signTransaction(
    request: SignRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<SignedTx, "unknown_wallet" | "refused">>;
}

/** The chains binference may use, filled once by the composition root. */
export interface ChainRegistry {
  /** The chain with this id. An id the registry does not hold is an expected failure. */
  get(ref: ChainRef): Result<RegisteredChain, "unknown_chain">;
  /** Every chain the registry holds, in the order they were registered. */
  list(): readonly RegisteredChain[];
}

/**
 * Reads the next nonce the chain expects from an account: how many transactions the chain counts
 * for it, those still waiting for a block included (`eth_getTransactionCount` at `pending` on an
 * EVM chain). A node does not see a transaction sent through a private relay before a block holds
 * it, so the wallet queue never trusts this count alone. Adapters: the EVM family's read over the
 * chain's RPC failover.
 */
export interface NonceSource {
  /**
   * The account's next nonce: a safe integer, 0 for an account the chain has never seen. Rejects
   * when no node answers, and with the signal's reason once the signal aborts.
   */
  next(account: AccountRef, options: { readonly signal: AbortSignal }): Promise<number>;
}

/**
 * A USD price as micro-dollars per base unit of one asset: `numerator` micro-dollars buy
 * `denominator` base units. A ratio stays exact for a token worth less than a micro-dollar a unit.
 */
export type UsdPrice = Ratio;

/**
 * Gives the USD price of an asset now (decision 0059): a feed for the native coin and stablecoins,
 * the trade's own quote for other tokens. A price is above zero, with a denominator above zero. An
 * asset it cannot price, or a price too old to trust, is `no_price`, never a throw, so the policy
 * refuses the trade. Adapters: Chainlink feeds read over the chain's RPC in `@binference/chain-evm`,
 * and a market-data service's latest reading.
 */
export interface PriceSource {
  /** The price of one asset. Rejects with the signal's reason once the signal aborts. */
  usdPrice(
    asset: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<UsdPrice, "no_price">>;
}
