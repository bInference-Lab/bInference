import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type ChainRef,
  type SignRequest,
  type WalletRole,
} from "@binference/chain";
import { parseEvmAddress } from "@binference/chain-evm";
import { err, type Id, ok, type Result } from "@binference/core";
import type { PrivyId } from "../privy/privy-records.js";

/** An agent wallet as Privy holds it, checked by the read-back when it was made. */
export interface PrivyWallet {
  /** Privy's id of the wallet. */
  readonly id: PrivyId;
  /** The wallet's EVM address, checksummed. */
  readonly address: string;
  /** The chains its ceiling enables. */
  readonly chains: readonly ChainRef[];
  /**
   * The wallet's role: `launch` for the agent's launch wallet (decision 0217), `bridge` for its
   * bridge wallet (decision 0303); absent for a main wallet.
   */
  readonly role?: WalletRole;
}

/** The Privy wallet behind an agent wallet, as the store keeps it; undefined for no wallet. */
export type WalletLookup = (wallet: Id<"wal">) => PrivyWallet | undefined;

// The wallet's account on a chain its ceiling enables; undefined on any other chain.
function walletAccount(wallet: PrivyWallet, chain: ChainRef): AccountRef | undefined {
  return wallet.chains.includes(chain)
    ? accountRefSchema.parse(`${chain}:${wallet.address}`)
    : undefined;
}

// The sender is the wallet's address on the transaction's own chain, in any case of its hex.
function isWalletSender(wallet: PrivyWallet, request: SignRequest): boolean {
  const { tx } = request;
  const sender = parseEvmAddress(accountRefParts(tx.from).address);
  return (
    accountRefParts(tx.from).chain === tx.chain && sender.ok && sender.value === wallet.address
  );
}

/**
 * The `Signer` port's `account`: the wallet's account on a chain its ceiling enables, else
 * `unknown_wallet`. Rejects with the signal's reason once it aborted.
 */
export async function accountOf(
  walletOf: WalletLookup,
  asked: { readonly wallet: Id<"wal">; readonly chain: ChainRef; readonly signal: AbortSignal },
): Promise<Result<AccountRef, "unknown_wallet">> {
  asked.signal.throwIfAborted();
  const held = walletOf(asked.wallet);
  const account = held === undefined ? undefined : walletAccount(held, asked.chain);
  return Promise.resolve(account === undefined ? err("unknown_wallet") : ok(account));
}

/**
 * The wallet that signs the request, with its account on the request's chain: `unknown_wallet`
 * for a wallet custody does not hold, `refused` for a chain its ceiling does not enable or a
 * sender that is not the wallet's account.
 */
export function signingWallet(
  walletOf: WalletLookup,
  request: SignRequest,
): Result<
  { readonly wallet: PrivyWallet; readonly account: AccountRef },
  "unknown_wallet" | "refused"
> {
  const wallet = walletOf(request.wallet);
  if (wallet === undefined) {
    return err("unknown_wallet");
  }
  const account = walletAccount(wallet, request.tx.chain);
  return account === undefined || !isWalletSender(wallet, request)
    ? err("refused")
    : ok({ wallet, account });
}
