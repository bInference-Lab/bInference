import { err, jsonValueSchema, ok } from "@binference/core";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineHandler } from "../operations/engine-call.js";
import { addAddress, type AddAddressOptions, addressEntryView } from "./add-address.js";

/** The handlers of an agent's address book (protocol spec, section 7.6). */
export interface AddressBookHandlers {
  readonly "address/list": EngineHandler<"address/list">;
  readonly "address/add": EngineHandler<"address/add">;
  readonly "address/remove": EngineHandler<"address/remove">;
}

/**
 * Creates the address book handlers. `address/list` answers the agent's live entries, oldest
 * first, each with the time send level 2 lets a send pay it. `address/add` saves an entry in the
 * agent's ceilings with the owner key first (see {@link addAddress}). `address/remove` is
 * braking: the entry stops counting for sends at once, and the removal is journaled and pushed as
 * `config/changed`; the ceilings keep listing it until the owner key changes them again.
 */
export function createAddressBookHandlers(options: AddAddressOptions): AddressBookHandlers {
  return {
    async "address/list"({ args, signal }) {
      const found = await activeAgent(options.agents, args.agent, { signal });
      return found.ok ? ok({ items: found.value.addressBook.map(addressEntryView) }) : found;
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
