import type { AccountRef, ChainRegistry, WalletRole } from "@binference/chain";
import type { Clock, Id } from "@binference/core";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import type { InstallFacts } from "../install/install-record.js";
import { roleOfWalletAccount } from "../install/role-wallet.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { AgentStore, InstallStore } from "../ports.js";

/** One live wallet's ceiling, its role, and the addresses its agent saved with the owner key. */
export interface WalletCeiling {
  readonly agent: Id<"agt">;
  readonly ceiling: string;
  readonly role?: WalletRole;
  /** Each address the agent saved in the ceiling, on its own chain (decision 0313). */
  readonly saved: readonly AccountRef[];
}

/**
 * The addresses of an address book a ceiling lists: each the owner key saved in the ceiling, on
 * its own chain, never a launch or bridge wallet's, though a book restored from a backup may hold
 * one (decisions 0218 and 0307).
 */
export function savedPayees(
  book: readonly AddressEntryRecord[],
  parts: { readonly facts: InstallFacts; readonly chains: ChainRegistry },
): readonly AccountRef[] {
  return book
    .filter((entry) => entry.inCeilingAtMs !== undefined)
    .map((entry) => entry.account)
    .filter(
      (account) => roleOfWalletAccount(parts.facts.wallets, account, parts.chains) === undefined,
    );
}

/** The rescue address in effect and a new one that waits, which every ceiling lists. */
export function rescueAccounts(
  facts: InstallFacts,
  nowMs: number,
): readonly (AccountRef | undefined)[] {
  const { rescueAddress, pendingRescue } = rescueAt(facts, nowMs);
  return [rescueAddress, pendingRescue?.address];
}

/** Each live wallet's ceiling, with the addresses its agent saved that a ceiling lists. */
export async function walletCeilings(
  parts: { readonly agents: AgentStore; readonly chains: ChainRegistry },
  facts: InstallFacts,
  signal: AbortSignal,
): Promise<readonly WalletCeiling[]> {
  const live = facts.wallets.filter((wallet) => wallet.archivedAtMs === undefined);
  const agents = [...new Set(live.map((wallet) => wallet.agentId))];
  const books = new Map(
    await Promise.all(
      agents.map(async (agent) => {
        const settings = await parts.agents.get(agent, { signal });
        const saved = savedPayees(settings?.addressBook ?? [], { facts, chains: parts.chains });
        return [agent, saved] as const;
      }),
    ),
  );
  return live.map((wallet): WalletCeiling => {
    const saved = books.get(wallet.agentId) ?? [];
    const held = { agent: wallet.agentId, ceiling: wallet.policyId, saved };
    return wallet.role === undefined ? held : Object.assign(held, { role: wallet.role });
  });
}

/**
 * Every account a ceiling lets its wallet pay: the addresses given, such as the rescue address in
 * effect and a new one that waits, then its agent's saved addresses, each once.
 */
export function walletRecipients(
  wallet: Pick<WalletCeiling, "saved">,
  addresses: readonly (AccountRef | undefined)[],
): readonly AccountRef[] {
  const listed = addresses.filter((address): address is AccountRef => address !== undefined);
  return [...new Set([...listed, ...wallet.saved])];
}

/**
 * Every account each live wallet's ceiling lets the wallet pay now, by its ceiling: the rescue
 * address in effect, a new one that waits, and its agent's saved addresses, each on its own chain
 * (decision 0313), so a change of calls derives the bridge rules from them.
 */
export async function ceilingRecipients(
  parts: {
    readonly agents: AgentStore;
    readonly chains: ChainRegistry;
    readonly install: InstallStore;
    readonly clock: Clock;
  },
  signal: AbortSignal,
): Promise<ReadonlyMap<string, readonly AccountRef[]>> {
  const facts = await parts.install.read({ signal });
  const rescues = rescueAccounts(facts, parts.clock.now());
  const wallets = await walletCeilings(parts, facts, signal);
  return new Map(wallets.map((wallet) => [wallet.ceiling, walletRecipients(wallet, rescues)]));
}
