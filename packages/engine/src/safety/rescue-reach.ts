import { type AccountRef, accountRefParts, type ChainRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { InstallFacts } from "../install/install-record.js";
import type { RescueReachRecord } from "../install/rescue-record.js";
import { rescueAt } from "../policy/rescue-change.js";

/**
 * Where the rescue addresses stand in each agent's bridge rules (decision 0321), and the most
 * addresses a ceiling lists for one chain.
 */
export interface RescueReach {
  readonly records: readonly RescueReachRecord[];
  readonly most: number;
}

/** The install's {@link RescueReach}, under a ceiling that lists at most `most` per chain. */
export function rescueReachOf(facts: InstallFacts, most: number): RescueReach {
  return { records: facts.rescueReach ?? [], most };
}

// Whether a standing lets an agent's bridge rules list the rescue address: it is in them.
function isListedStanding(record: RescueReachRecord): boolean {
  return record.state === "joined" || record.state === "waiting";
}

const addressOf = (account: AccountRef): string => accountRefParts(account).address.toLowerCase();
const chainOf = (account: AccountRef): string => accountRefParts(account).chain;

/** The rescue address on each destination, for one agent's ceiling. */
export interface RescueJoins {
  /** Each account the ceiling lists, after the accounts it pays otherwise. */
  readonly added: readonly AccountRef[];
  /** Each account the agent's standing lists that the chain's list had no room for. */
  readonly roomed: readonly AccountRef[];
}

/**
 * The rescue addresses on destinations an agent's ceiling lists (decision 0321): each one its
 * standing lists, for a rescue address the ceiling lists, only on a chain where it pays another
 * account, so a bridge rule exists there, and only while the chain's list has room after every
 * other account; a standing left out for room is `roomed`.
 */
export function rescueJoinsOf(
  listed: readonly AccountRef[],
  owner: {
    readonly agent: Id<"agt">;
    readonly rescues: readonly AccountRef[];
    readonly reach: RescueReach;
  },
): RescueJoins {
  const homes = new Set(owner.rescues.map(addressOf));
  const passes = owner.reach.records
    .filter((record) => record.agent === owner.agent && isListedStanding(record))
    .map((record) => record.account)
    .filter((account) => homes.has(addressOf(account)) && !listed.includes(account));
  const added: AccountRef[] = [];
  const roomed: AccountRef[] = [];
  for (const account of passes) {
    const chain = chainOf(account);
    const there = [...listed, ...added].filter((item) => chainOf(item) === chain);
    if (listed.some((item) => chainOf(item) === chain)) {
      (there.length < owner.reach.most ? added : roomed).push(account);
    }
  }
  return { added, roomed };
}

/**
 * The rescue addresses one agent's ceiling lists on a chain, the one source the address book's room
 * reads (decision 0321): the one in effect and a new one that waits on their own chain, and on a
 * destination each the agent's standing lists there.
 */
export function rescuesOn(
  facts: InstallFacts,
  at: { readonly agent: Id<"agt">; readonly chain: ChainRef; readonly nowMs: number },
): readonly AccountRef[] {
  const { rescueAddress, pendingRescue } = rescueAt(facts, at.nowMs);
  const homes = [rescueAddress, pendingRescue?.address].filter(
    (account): account is AccountRef => account !== undefined,
  );
  const addresses = new Set(homes.map(addressOf));
  const listed = (facts.rescueReach ?? [])
    .filter((record) => record.agent === at.agent && isListedStanding(record))
    .map((record) => record.account)
    .filter((account) => addresses.has(addressOf(account)));
  return [...homes, ...listed].filter((account) => chainOf(account) === at.chain);
}
