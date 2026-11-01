import {
  type AccountCodeReader,
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type ChainRegistry,
  chainRefParts,
} from "@binference/chain";
import type { Clock, Id } from "@binference/core";
import type { DestinationChain } from "../address-book/destination-chain.js";
import { isPlainOnBoth } from "../bridges/bridge-checks.js";
import type { InstallFacts } from "../install/install-record.js";
import type { RescueReachRecord, RescueReachState } from "../install/rescue-record.js";
import type { RescueState } from "../policy/rescue-change.js";
import type { AgentStore, InstallStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { isListedStanding } from "./rescue-reach.js";
import { walletCeilings } from "./wallet-recipients.js";

/**
 * What the plain-wallet check of the rescue address reads (decision 0321): the chains a bridge
 * delivers to, each with its code reader where it is an EVM chain, and the code readers of the
 * wallets' chains.
 */
export interface RescueReads {
  readonly destinations: readonly DestinationChain[];
  readonly codeReaders: readonly AccountCodeReader[];
}

/** What a check of the rescue addresses reads, keeps and announces through. */
export interface RescueCheckParts {
  readonly install: InstallStore;
  readonly agents: AgentStore;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly publish: PublishPush;
  /** The reads of the check; without them nothing is checked. */
  readonly rescueReads?: RescueReads;
}

/** What an owner key's write checks the rescue addresses for. */
export interface RescueCheckPlan {
  /** The agents whose ceilings the write covers, each on the destinations its rules serve. */
  readonly agents: readonly Id<"agt">[];
  /** The rescue address in effect and the one that waits, as the write leaves them. */
  readonly rescue: RescueState;
  /** A new rescue address, read afresh. */
  readonly fresh?: AccountRef;
  /** An address the write saves for an agent on a destination, whose rules it serves then. */
  readonly saving?: { readonly agent: Id<"agt">; readonly account: AccountRef };
}

/** What a check found, for its write to list and for {@link keepCheckedReach} to keep. */
export interface RescueChecked {
  readonly plan: RescueCheckPlan;
  /** Every standing as kept before the check. */
  readonly before: readonly RescueReachRecord[];
  /** The standings the check found for the plan's agents. */
  readonly found: readonly RescueReachRecord[];
}

const addressOf = (account: AccountRef): string => accountRefParts(account).address.toLowerCase();

// The rescue address on a destination: through the destination's codec, or, on a chain of another
// family, the address as written, which no bridge pays (decision 0298).
function thereOf(
  home: AccountRef,
  destination: DestinationChain,
): { readonly account?: AccountRef; readonly isOtherKind: boolean } {
  const { chain, address } = accountRefParts(home);
  const isOtherKind = chainRefParts(chain).namespace !== destination.codec.namespace;
  const canonical = isOtherKind ? undefined : destination.codec.parse(address);
  const written = canonical?.ok === true ? canonical.value : address;
  const parsed = accountRefSchema.safeParse(`${destination.ref}:${written}`);
  return {
    ...(parsed.success ? { account: parsed.data } : {}),
    isOtherKind: isOtherKind || canonical?.ok !== true,
  };
}

/** One rescue address to read on one destination for one agent. */
interface RescueAsk {
  readonly agent: Id<"agt">;
  readonly home: AccountRef;
  readonly destination: DestinationChain;
}

// What the read of a rescue address on a destination says: no code on either chain, code, a chain
// it could not read or with no reader, or a chain of another kind.
async function readOne(
  reads: RescueReads,
  asked: RescueAsk,
  signal: AbortSignal,
): Promise<"plain" | "code" | "unread" | "kind"> {
  const { home, destination } = asked;
  const there = thereOf(home, destination);
  if (there.isOtherKind || there.account === undefined) {
    return "kind";
  }
  const here = reads.codeReaders.find((reader) => reader.chain === accountRefParts(home).chain);
  if (here === undefined || destination.codes === undefined) {
    return "unread";
  }
  try {
    const plain = await isPlainOnBoth(
      { here, there: destination.codes },
      { home, there: there.account },
      signal,
    );
    return plain ? "plain" : "code";
  } catch {
    signal.throwIfAborted();
    return "unread";
  }
}

// The destinations each agent's bridge rules serve: those it saved an address for, and the one the
// write saves for it.
async function servedOf(
  parts: RescueCheckParts,
  held: { readonly facts: InstallFacts; readonly plan: RescueCheckPlan },
  signal: AbortSignal,
): Promise<ReadonlyMap<Id<"agt">, readonly AccountRef[]>> {
  const { facts, plan } = held;
  const wallets = await walletCeilings(parts, facts, signal);
  return new Map(
    plan.agents.map((agent) => {
      const saved = wallets.find((wallet) => wallet.agent === agent)?.saved ?? [];
      const saving = plan.saving?.agent === agent ? [plan.saving.account] : [];
      return [agent, [...saved, ...saving]];
    }),
  );
}

// Each agent, rescue address and served destination to check: never one where the agent saved the
// rescue address itself, which a bridge pays as an entry.
function asksOf(
  destinations: readonly DestinationChain[],
  plan: RescueCheckPlan,
  served: ReadonlyMap<Id<"agt">, readonly AccountRef[]>,
): readonly RescueAsk[] {
  const { rescueAddress, pendingRescue } = plan.rescue;
  const homes = [rescueAddress, pendingRescue?.address].filter(
    (account): account is AccountRef => account !== undefined,
  );
  return plan.agents.flatMap((agent) => {
    const accounts = served.get(agent) ?? [];
    const chains = new Set(accounts.map((account) => accountRefParts(account).chain));
    return destinations
      .filter((destination) => chains.has(destination.ref))
      .flatMap((destination) =>
        homes
          .filter((home) => {
            const there = thereOf(home, destination).account;
            return there === undefined || !accounts.includes(there);
          })
          .map((home): RescueAsk => ({ agent, home, destination })),
      );
  });
}

// The standing a read gives: listed, as in effect or waiting, or left out for its reason.
function stateOf(
  outcome: "plain" | "code" | "unread" | "kind",
  rescue: { readonly plan: RescueCheckPlan; readonly home: AccountRef },
): RescueReachState {
  if (outcome !== "plain") {
    return outcome;
  }
  return rescue.plan.rescue.pendingRescue?.address === rescue.home ? "waiting" : "joined";
}

/**
 * Runs the plain-wallet check of the rescue addresses before an owner key's write (decision 0321),
 * for each agent the write covers, on each destination its bridge rules serve: the rescue address
 * in effect and the one that waits, a standing that lists one kept unread unless it is `fresh`,
 * every other read again, each account read once whichever agent asks. A destination of another
 * kind, with no reader, or one where the agent saved the rescue address itself, is told as such
 * or skipped. It keeps nothing: {@link keepCheckedReach} does, from what the write's read-back holds.
 */
export async function checkRescueReach(
  parts: RescueCheckParts,
  plan: RescueCheckPlan,
  signal: AbortSignal,
): Promise<RescueChecked> {
  const facts = await parts.install.read({ signal });
  const before = facts.rescueReach ?? [];
  const destinations = parts.rescueReads?.destinations ?? [];
  const asks = asksOf(destinations, plan, await servedOf(parts, { facts, plan }, signal));
  const reads = parts.rescueReads ?? { destinations: [], codeReaders: [] };
  const fresh = plan.fresh === undefined ? undefined : addressOf(plan.fresh);
  const outcomes = new Map<string, Promise<"plain" | "code" | "unread" | "kind">>();
  const found = await Promise.all(
    asks.map(async (ask): Promise<RescueReachRecord | undefined> => {
      const account = thereOf(ask.home, ask.destination).account;
      if (account === undefined) {
        return undefined;
      }
      const held = before.find((item) => item.agent === ask.agent && item.account === account);
      const isKept = held !== undefined && isListedStanding(held) && addressOf(account) !== fresh;
      const key = `${ask.home} ${ask.destination.ref}`;
      const read = isKept ? "plain" : (outcomes.get(key) ?? readOne(reads, ask, signal));
      if (typeof read !== "string") {
        outcomes.set(key, read);
      }
      const state = stateOf(await read, { plan, home: ask.home });
      return { agent: ask.agent, account, state };
    }),
  );
  return { plan, before, found: found.flatMap((item) => (item === undefined ? [] : [item])) };
}

/** The install's facts with the standings a check found in place of its agents' kept ones. */
export function withCheckedReach(facts: InstallFacts, checked: RescueChecked): InstallFacts {
  const agents = new Set(checked.plan.agents);
  const others = (facts.rescueReach ?? []).filter((record) => !agents.has(record.agent));
  return { ...facts, rescueReach: [...others, ...checked.found] };
}
