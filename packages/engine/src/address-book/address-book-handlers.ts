import { type AccountRef, accountRefParts, type ChainRef } from "@binference/chain";
import { err, type Id, jsonValueSchema, ok } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import { bridgeWalletsReach } from "../bridges/bridge-routes.js";
import type { InstallFacts } from "../install/install-record.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineHandler } from "../operations/engine-call.js";
import { rescuesOn } from "../safety/rescue-reach.js";
import { addAddress, type AddAddressOptions, addressEntryView } from "./add-address.js";

/** The handlers of an agent's address book (protocol spec, section 7.6). */
export interface AddressBookHandlers {
  readonly "address/list": EngineHandler<"address/list">;
  readonly "address/add": EngineHandler<"address/add">;
  readonly "address/remove": EngineHandler<"address/remove">;
}

// The room left on each chain other than the wallets' that holds a saved address (decision 0297),
// the rescue addresses counted as `rescuesOn` counts them for `address/add` (decision 0321).
function roomOf(
  settings: AgentSettings,
  limits: {
    readonly isWalletChain: (chain: ChainRef) => boolean;
    readonly most: number;
    readonly facts: InstallFacts;
    readonly nowMs: number;
  },
) {
  const saved = settings.addressBook.map((entry) => entry.account);
  const chains = [
    ...new Set(
      saved
        .map((account) => accountRefParts(account).chain)
        .filter((chain) => !limits.isWalletChain(chain)),
    ),
  ];
  return chains.map((chain) => {
    const listed = saved.filter((account) => accountRefParts(account).chain === chain);
    const at = { agent: settings.agent.id, chain, nowMs: limits.nowMs };
    const rescues = rescuesOn(limits.facts, at).filter((account) => !listed.includes(account));
    return { chain, used: listed.length + rescues.length, most: limits.most };
  });
}

// Every account a bridge rule of the agent's live wallets pays, as their stored copies read.
async function bridgedNow(
  options: AddAddressOptions,
  agent: Id<"agt">,
  signal: AbortSignal,
): Promise<ReadonlySet<AccountRef>> {
  const { wallets } = await options.install.read({ signal });
  const owned = wallets.filter(
    (wallet) => wallet.agentId === agent && wallet.archivedAtMs === undefined,
  );
  return new Set(
    owned.flatMap((wallet) => options.ceilings.readStored(wallet.ceiling.policy)?.bridged ?? []),
  );
}

// Whether nothing pays an entry yet: it was saved for a destination where no bridge rule of the
// agent's wallets lists it, and no bridge from the bridge wallet the agent may use reaches
// (decision 0463).
function hasNoRoute(
  options: Pick<AddAddressOptions, "bridges">,
  paid: ReadonlySet<AccountRef>,
  entry: {
    readonly account: AccountRef;
    readonly venues: readonly string[];
    readonly isWalletChain: (chain: ChainRef) => boolean;
  },
): boolean {
  const { chain } = accountRefParts(entry.account);
  const reach = { chain, venues: entry.venues };
  return (
    !entry.isWalletChain(chain) &&
    !paid.has(entry.account) &&
    !bridgeWalletsReach(options.bridges ?? [], reach)
  );
}

/**
 * Creates the address book handlers. `address/list` answers the agent's live entries, oldest
 * first, each with the time send level 2 lets a send pay it, marked when it was saved for a
 * destination no bridge rule of the agent's wallets reaches yet, nor a bridge from the bridge
 * wallet the agent may use (decision 0463), and the room left on each other
 * chain it saved an address for. `address/add` saves an entry in the
 * agent's ceilings with the owner key first (see {@link addAddress}). `address/remove` is
 * braking: the entry stops counting for sends at once, and the removal is journaled and pushed as
 * `config/changed`; the ceilings keep listing it until the owner key changes them again.
 */
export function createAddressBookHandlers(options: AddAddressOptions): AddressBookHandlers {
  return {
    async "address/list"({ args, signal }) {
      const found = await activeAgent(options.agents, args.agent, { signal });
      if (!found.ok) {
        return found;
      }
      const isWalletChain = (chain: ChainRef) => options.chains.get(chain).ok;
      const paid = await bridgedNow(options, args.agent, signal);
      const facts = await options.install.read({ signal });
      const most = options.ceilings.mostPerChain;
      const nowMs = options.clock.now();
      const room = roomOf(found.value, { isWalletChain, most, facts, nowMs });
      const { venues } = found.value.limits;
      const items = found.value.addressBook.map((entry) =>
        addressEntryView(entry, {
          noRoute: hasNoRoute(options, paid, { account: entry.account, venues, isWalletChain }),
        }),
      );
      return ok(room.length === 0 ? { items } : { items, room });
    },
    "address/add": async (call) => addAddress(options, call),
    async "address/remove"({ args, caller, signal }) {
      const atMs = options.clock.now();
      const removed = await options.agents.removeAddress({ id: args.entry, atMs }, { signal });
      if (!removed.ok) {
        return err("address.not_found");
      }
      const settings = await options.agents.get(removed.value.agentId, { signal });
      const name = settings?.agent.name ?? removed.value.agentId;
      await journalConfigChange(
        options,
        {
          author: authorOf(caller),
          atMs,
          path: `agents.${name}.addressBook.${removed.value.id}`,
          before: jsonValueSchema.parse(addressEntryView(removed.value)),
        },
        { signal },
      );
      return ok({});
    },
  };
}
