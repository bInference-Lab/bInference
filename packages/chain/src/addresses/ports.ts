import type { Result } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";

/**
 * A chain family's address codec (decision 0298): it checks an address as people write it, such
 * as a checksummed hex address or a base58 Solana address, and converts it to and from its
 * recipient bytes, the bytes a ceiling compares a recipient with. Adapters: the EVM family's (20
 * bytes) and Solana's (32 bytes).
 */
export interface AddressCodec {
  /** The CAIP-2 namespace of the family's chains, such as `eip155`. */
  readonly namespace: string;
  /** How many recipient bytes every address of the family holds. */
  readonly recipientLength: number;
  /**
   * The address in the family's canonical form, which compares equal for one account. Text that
   * is no address of the family is an expected failure, never a throw.
   */
  parse(text: string): Result<string, "malformed_address">;
  /** The recipient bytes of an address as `parse` takes it; text it refuses fails the same way. */
  toBytes(text: string): Result<Uint8Array, "malformed_address">;
  /** The canonical address recipient bytes spell; bytes of another length are an expected failure. */
  fromBytes(bytes: Readonly<Uint8Array>): Result<string, "malformed_address">;
}

/**
 * Whether an account can take a payment as a wallet: `not_wallet` for an account a family knows
 * no one can spend from as a wallet, such as a program or a token account on Solana.
 */
export type AccountKind = "wallet" | "not_wallet";

/**
 * Reads what kind of account an address is on one chain, before the owner saves it (decision
 * 0298): on Solana an executable program, an account a program other than the System Program
 * owns, such as a token account, an account that holds data, such as a durable nonce, and an
 * address no key can sign for, such as a program-derived address, are `not_wallet`; an address a
 * key can sign for with no account yet is a wallet. It only reads. Adapter: Solana's, over its
 * JSON-RPC at the latest finalized slot.
 */
export interface AccountKindReader {
  /** The chain it reads. */
  readonly chain: ChainRef;
  /**
   * The account's kind. An account of another chain is a fault; a node that cannot answer
   * rejects, and so does the signal once it aborts.
   */
  read(account: AccountRef, options: { readonly signal: AbortSignal }): Promise<AccountKind>;
}

/**
 * What an account holds as code on one chain (decision 0318): `none`, a plain wallet whose key
 * holds it on every chain of its family; `delegation`, only an EIP-7702 delegation; `token`, code
 * that answers a token's supply and decimals, where a payment is lost; `contract`, any other code,
 * such as a contract wallet.
 */
export type AccountCode = "none" | "delegation" | "token" | "contract";

/**
 * Reads what code an account holds on one chain, at its latest block: the rescue address's plain
 * wallet check before a bridge pays it on another chain, and a token refused as a payee there
 * (decision 0318). It only reads. Adapter: the EVM family's, over the chain's RPC failover.
 */
export interface AccountCodeReader {
  /** The chain it reads. */
  readonly chain: ChainRef;
  /**
   * The account's code. An account of another chain is a fault; a node that cannot answer
   * rejects, and so does the signal once it aborts.
   */
  read(account: AccountRef, options: { readonly signal: AbortSignal }): Promise<AccountCode>;
}
