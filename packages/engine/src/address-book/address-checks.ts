import { type AccountRef, accountRefParts, type ChainRef } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { InstallFacts } from "../install/install-record.js";
import { rescueAt } from "../policy/rescue-change.js";
import { payeeRefusal } from "./payee-refusal.js";
import { type AddressChains, isOwnWalletElsewhere, type SavedAccount } from "./saved-account.js";

/** What the checks of an address to save read. */
export interface AddressCheckParts extends AddressChains {
  /** The most addresses one ceiling lists for one chain. */
  readonly mostPerChain: number;
  readonly nowMs: number;
}

const chainOf = (account: AccountRef): ChainRef => accountRefParts(account).chain;

/**
 * Why the account may not be saved for the agent, before anything is read on chain: on a wallet
 * chain, a launch or bridge wallet of the install or a venue's contract (see `payeeRefusal`); on a
 * destination, any wallet of the install (`address.own_wallet`), since no bridge pays binference's
 * own address on another chain; and on either, a chain whose ceiling rule lists the most it can,
 * the rescue address among them on its own chain (`address.chain_full`). `undefined` when none.
 */
export function addressRefusal(
  parts: AddressCheckParts,
  saving: {
    readonly saved: SavedAccount;
    readonly facts: InstallFacts;
    readonly settings: AgentSettings;
  },
): ProtocolErrorCode | undefined {
  const { saved, facts, settings } = saving;
  const wallets = facts.wallets.map((wallet) => wallet.address);
  if (saved.isWalletChain) {
    const refusal = payeeRefusal(facts.wallets, saved.account, parts.chains);
    if (refusal !== undefined) {
      return refusal;
    }
  } else if (isOwnWalletElsewhere(parts, saved, wallets)) {
    return "address.own_wallet";
  }
  const chain = chainOf(saved.account);
  const { rescueAddress, pendingRescue } = rescueAt(facts, parts.nowMs);
  const rescues = [rescueAddress, pendingRescue?.address].filter(
    (account) => account !== undefined && chainOf(account) === chain,
  );
  const listed = settings.addressBook.filter((entry) => chainOf(entry.account) === chain);
  return listed.length + rescues.length >= parts.mostPerChain ? "address.chain_full" : undefined;
}

/**
 * Whether the account can hold what a payment brings it, by its chain's readers: no program or
 * token account (decision 0298) and no token's own contract (decision 0318); a chain with no
 * reader of a kind reads as a wallet for that kind. A read that fails rejects.
 */
export async function isWalletAccount(
  saved: Pick<SavedAccount, "account" | "kinds" | "codes">,
  signal: AbortSignal,
): Promise<boolean> {
  const kind =
    saved.kinds === undefined ? "wallet" : await saved.kinds.read(saved.account, { signal });
  const code =
    saved.codes === undefined ? "none" : await saved.codes.read(saved.account, { signal });
  return kind === "wallet" && code !== "token";
}

/**
 * Reads, on a chain whose readers can tell, whether the account is a wallet: a program or a token
 * account on Solana (decision 0298), or a token's own contract on an EVM destination (decision
 * 0318), is `address.not_wallet`, and a read that fails for any reason but the call's own abort,
 * a node that does not answer or an answer the reader cannot read, is `chain.rpc_down`, so nothing
 * is saved unread. On any other chain nothing is read.
 */
export async function walletCheck(
  saved: SavedAccount,
  signal: AbortSignal,
): Promise<Result<void, ProtocolErrorCode>> {
  try {
    return (await isWalletAccount(saved, signal)) ? ok(undefined) : err("address.not_wallet");
  } catch {
    signal.throwIfAborted();
    return err("chain.rpc_down");
  }
}
