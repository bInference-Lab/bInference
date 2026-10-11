import type { AccountRef, ChainRegistry, Signer } from "@binference/chain";
import type { Ok, Result } from "@binference/core";
import type { WalletView } from "@binference/protocol";
import type { WalletRecord } from "../install/install-record.js";

/** What a wallet view reads its address from: custody's account on each registered chain. */
export interface WalletViewParts {
  readonly custody: Signer;
  readonly chains: ChainRegistry;
}

function isHeld(account: Result<AccountRef, "unknown_wallet">): account is Ok<AccountRef> {
  return account.ok;
}

/**
 * A stored wallet as the protocol shows it, with its account on the first registered chain where
 * custody holds it; `undefined` when custody holds it on none, so no wallet is ever shown without
 * the address custody signs for.
 */
export async function walletViewOf(
  parts: WalletViewParts,
  wallet: WalletRecord,
  signal: AbortSignal,
): Promise<WalletView | undefined> {
  const accounts = await Promise.all(
    parts.chains
      .list()
      .map(async (chain) => parts.custody.account(wallet.id, chain.ref, { signal })),
  );
  const account = accounts.find(isHeld);
  return account === undefined
    ? undefined
    : {
        wallet: wallet.id,
        agent: wallet.agentId,
        address: account.value,
        label: wallet.label,
        createdAt: wallet.createdAtMs,
        ...(wallet.archivedAtMs === undefined ? {} : { archivedAt: wallet.archivedAtMs }),
      };
}
