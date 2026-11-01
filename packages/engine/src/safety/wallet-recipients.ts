import type { AccountRef, ChainRegistry, WalletRole } from "@binference/chain";
import type { Clock, Id } from "@binference/core";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import type { InstallFacts } from "../install/install-record.js";
import type { RescueReachRecord } from "../install/rescue-record.js";
import { roleOfWalletAccount } from "../install/role-wallet.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { AgentStore, InstallStore } from "../ports.js";
import { type RescueReach, rescueJoinsOf, rescueReachOf } from "./rescue-reach.js";

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

/** Whom a ceiling pays besides its agent's saved addresses. */
export interface CeilingPayees {
  /** The rescue address in effect and a new one that waits, each on its own chain. */
  readonly rescues: readonly (AccountRef | undefined)[];
  readonly reach: RescueReach;
  /** An account being saved for the agent, listed with its saved addresses. */
  readonly saving?: AccountRef;
}

// What a ceiling lists before the rescue addresses on destinations, and those addresses' joins.
function joinsOf(wallet: Pick<WalletCeiling, "agent" | "saved">, payees: CeilingPayees) {
  const rescues = payees.rescues.filter((address): address is AccountRef => address !== undefined);
  const saving = payees.saving === undefined ? [] : [payees.saving];
  const listed = [...new Set([...rescues, ...saving, ...wallet.saved])];
  const joins = rescueJoinsOf(listed, { agent: wallet.agent, rescues, reach: payees.reach });
  return { listed, joins };
}

/**
 * Every account a ceiling lets its wallet pay: the rescue addresses given, an account being saved,
 * its agent's saved addresses, each once, then the rescue address on each destination its agent's
 * standing lists, where a bridge rule pays a saved address and the chain's list has room
 * (decision 0321).
 */
export function walletRecipients(
  wallet: Pick<WalletCeiling, "agent" | "saved">,
  payees: CeilingPayees,
): readonly AccountRef[] {
  const { listed, joins } = joinsOf(wallet, payees);
  return [...listed, ...joins.added];
}

/** Each rescue address on a destination its agent's standing lists that the ceiling had no room for. */
export function roomedOut(
  wallet: Pick<WalletCeiling, "agent" | "saved">,
  payees: CeilingPayees,
): readonly AccountRef[] {
  return joinsOf(wallet, payees).joins.roomed;
}

/**
 * Every account each live wallet's ceiling lets the wallet pay now, by its ceiling: the rescue
 * address in effect, a new one that waits, and its agent's saved addresses, each on its own chain
 * (decision 0313), with the rescue address on the destinations it passed its check on (decision
 * 0321), so a change of calls derives the bridge rules from them.
 */
export async function ceilingRecipients(
  parts: {
    readonly agents: AgentStore;
    readonly chains: ChainRegistry;
    readonly install: InstallStore;
    readonly clock: Clock;
    readonly most: number;
    /** The rescue addresses' standings a check found for this write, in place of the kept ones. */
    readonly records?: readonly RescueReachRecord[];
  },
  signal: AbortSignal,
): Promise<ReadonlyMap<string, readonly AccountRef[]>> {
  const facts = await parts.install.read({ signal });
  const rescues = rescueAccounts(facts, parts.clock.now());
  const held = rescueReachOf(facts, parts.most);
  const reach = parts.records === undefined ? held : { ...held, records: parts.records };
  const wallets = await walletCeilings(parts, facts, signal);
  return new Map(
    wallets.map((wallet) => [wallet.ceiling, walletRecipients(wallet, { rescues, reach })]),
  );
}
