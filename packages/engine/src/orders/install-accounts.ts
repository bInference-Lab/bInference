import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type ChainRef,
  type ChainRegistry,
  type Signer,
} from "@binference/chain";
import type { WalletRecord } from "../install/install-record.js";
import type { InstallStore } from "../ports.js";

/** What tells whether an account is one of the install's wallets. */
export interface InstallAccountParts {
  /** The install's wallets, of every agent, archived ones among them. */
  readonly install: Pick<InstallStore, "read">;
  /** Custody, which holds each wallet's account on each chain. */
  readonly custody: Pick<Signer, "account">;
  readonly chains: ChainRegistry;
}

// The wallet's account on `chain` from the address the install keeps, in its family's canonical
// form; none for a wallet of another family. It answers while custody is locked.
function keptAccountOf(
  chains: ChainRegistry,
  wallet: WalletRecord,
  chain: ChainRef,
): AccountRef | undefined {
  const registered = chains.get(chain);
  const family = registered.ok ? registered.value.family : undefined;
  const parsed = family?.id === wallet.family ? family.parseAddress(wallet.address) : undefined;
  return parsed?.ok === true ? accountRefSchema.parse(`${chain}:${parsed.value}`) : undefined;
}

/**
 * Whether `account`, in its canonical form, is one of the install's wallets on its chain, of any
 * agent and archived ones among them, by the address the install keeps or the one custody holds. A
 * copy order never follows one: its copies would be leader trades in turn, and two agents copying
 * each other would buy without end (decision 0261).
 */
export async function isInstallAccount(
  parts: InstallAccountParts,
  account: AccountRef,
  signal: AbortSignal,
): Promise<boolean> {
  const { chain } = accountRefParts(account);
  const { wallets } = await parts.install.read({ signal });
  const held = await Promise.all(
    wallets.map(async (wallet) => parts.custody.account(wallet.id, chain, { signal })),
  );
  const kept = wallets.map((wallet) => keptAccountOf(parts.chains, wallet, chain));
  return kept.includes(account) || held.some((owned) => owned.ok && owned.value === account);
}
