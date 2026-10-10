import { type AccountRef, accountRefSchema, type ChainRegistry } from "@binference/chain";
import {
  BinferenceError,
  createSecret,
  err,
  type IdSource,
  jsonValueSchema,
  ok,
  type Result,
} from "@binference/core";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import { activeAgent } from "../operations/active-agent.js";
import { canonicalAccount } from "../operations/canonical-account.js";
import type { EngineCall } from "../operations/engine-call.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import type { ConfigJournal } from "../ports.js";
import {
  type RescueCeilingsOptions,
  resignRescueCeilings,
  saveInCeilings,
  settleRescueCeilings,
} from "../safety/rescue-ceilings.js";

/** What saving an address reads, writes and journals through. */
export interface AddAddressOptions extends RescueCeilingsOptions {
  readonly journal: ConfigJournal;
  readonly chains: ChainRegistry;
  readonly ids: IdSource;
}

type AddressEntryView = ResultOf<"address/add">;

/** An address book entry as the address book operations answer it. */
export function addressEntryView(entry: AddressEntryRecord): AddressEntryView {
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

function accountOf(chains: ChainRegistry, call: EngineCall<"address/add">) {
  const typed = accountRefSchema.safeParse(`${call.args.chain}:${call.args.address}`);
  return typed.success ? canonicalAccount(chains, typed.data) : err("protocol.bad_args" as const);
}

async function record(
  options: AddAddressOptions,
  call: EngineCall<"address/add">,
  added: { readonly entry: AddressEntryRecord; readonly name: string },
): Promise<void> {
  const { entry, name } = added;
  await journalConfigChange(
    options,
    {
      author: authorOf(call.caller),
      atMs: entry.createdAtMs,
      path: `agents.${name}.addressBook.${entry.id}`,
      after: jsonValueSchema.parse(addressEntryView(entry)),
    },
    { signal: call.signal },
  );
}

// The live entry of the account, once a write found the book holding it already.
async function savedEntry(
  options: AddAddressOptions,
  call: EngineCall<"address/add">,
  account: AccountRef,
): Promise<Result<AddressEntryView, ProtocolErrorCode>> {
  const found = await activeAgent(options.agents, call.args.agent, { signal: call.signal });
  if (!found.ok) {
    return found;
  }
  const saved = found.value.addressBook.find((entry) => entry.account === account);
  if (saved === undefined) {
    throw new BinferenceError({
      code: "engine.address_unsaved",
      message: "The agent store refused an address book entry it does not hold.",
    });
  }
  return ok(addressEntryView(saved));
}

async function storeEntry(
  options: AddAddressOptions,
  call: EngineCall<"address/add">,
  saving: { readonly account: AccountRef; readonly name: string },
): Promise<Result<AddressEntryView, ProtocolErrorCode>> {
  const atMs = options.clock.now();
  const entry: AddressEntryRecord = {
    id: options.ids.next("adr"),
    agentId: call.args.agent,
    account: saving.account,
    label: call.args.label,
    usableAtMs: atMs + looseningWaitMs,
    inCeilingAtMs: atMs,
    createdAtMs: atMs,
  };
  const added = await options.agents.addAddress(entry, { signal: call.signal });
  if (!added.ok) {
    return savedEntry(options, call, saving.account);
  }
  await record(options, call, { entry: added.value, name: saving.name });
  return ok(addressEntryView(added.value));
}

/**
 * Saves an address in an agent's address book with the owner key (spec 5, section 4; decision
 * 0091): first in the ceiling of each of the agent's live wallets, then in the book, journaled and
 * pushed as `config/changed`; while a new rescue address waits, the owner key signs its changes
 * again over the ceilings as they list now. Send level 2 lets a send pay it from 24 hours after it
 * was saved (decision 0111). An address the book holds already is answered as it is, and nothing
 * changes. The owner key reaches this call over IPC only, as the protocol server keeps it; a wrong
 * one is `wallet.bad_owner_key`, an address its chain cannot read `protocol.bad_args`, and a
 * ceiling custody does not hold `wallet.not_found`.
 */
export async function addAddress(
  options: AddAddressOptions,
  call: EngineCall<"address/add">,
): Promise<Result<AddressEntryView, ProtocolErrorCode>> {
  const { args, signal } = call;
  const found = await activeAgent(options.agents, args.agent, { signal });
  if (!found.ok) {
    return found;
  }
  const account = accountOf(options.chains, call);
  if (!account.ok) {
    return account;
  }
  const saved = found.value.addressBook.find((entry) => entry.account === account.value);
  if (saved !== undefined) {
    return ok(addressEntryView(saved));
  }
  await settleRescueCeilings(options, signal);
  const facts = await options.install.read({ signal });
  const ownerKey = createSecret(args.ownerKey);
  const move = { facts, agent: args.agent, account: account.value, ownerKey, signal };
  const inCeiling = await saveInCeilings(options, move);
  if (!inCeiling.ok) {
    return inCeiling;
  }
  const stored = await storeEntry(options, call, {
    account: account.value,
    name: found.value.agent.name,
  });
  // A refusal here keeps the changes signed before; custody refuses them once due, and says so.
  await resignRescueCeilings(options, ownerKey, signal);
  return stored;
}
