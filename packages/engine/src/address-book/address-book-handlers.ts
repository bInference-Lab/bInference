import { type Clock, err, jsonValueSchema, ok } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { journalConfigChange } from "../audit/journal-config-change.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { AgentStore, ConfigJournal } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";

/** The handlers of an agent's address book (protocol spec, section 7.6). */
export interface AddressBookHandlers {
  readonly "address/list": EngineHandler<"address/list">;
  readonly "address/remove": EngineHandler<"address/remove">;
}

/** What the address book handlers read, write and journal through. */
export interface AddressBookHandlersOptions {
  readonly agents: AgentStore;
  readonly journal: ConfigJournal;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

type AddressEntryView = ResultOf<"address/add">;

function viewOf(entry: AddressEntryRecord): AddressEntryView {
  return {
    entry: entry.id,
    agent: entry.agentId,
    address: entry.account,
    label: entry.label,
    usableAt: entry.usableAtMs,
    ...(entry.inCeilingAtMs === undefined ? {} : { inCeilingAt: entry.inCeilingAtMs }),
    createdAt: entry.createdAtMs,
  };
}

/**
 * Creates the address book handlers. `address/list` answers the agent's live entries, oldest
 * first, each with the time send level 2 lets a send pay it. `address/remove` is braking: the
 * entry stops counting for sends at once, and the removal is journaled and pushed as
 * `config/changed`. Adding an entry saves it in the ceiling too, so it needs the owner key.
 */
export function createAddressBookHandlers(
  options: AddressBookHandlersOptions,
): AddressBookHandlers {
  return {
    async "address/list"({ args, signal }) {
      const found = await activeAgent(options.agents, args.agent, { signal });
      return found.ok ? ok({ items: found.value.addressBook.map(viewOf) }) : found;
    },
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
          caller,
          atMs,
          path: `agents.${name}.addressBook.${removed.value.id}`,
          before: jsonValueSchema.parse(viewOf(removed.value)),
        },
        { signal },
      );
      return ok({});
    },
  };
}
