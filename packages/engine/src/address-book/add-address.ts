import type { AccountRef } from "@binference/chain";
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
import type { AgentSettings } from "../agents/agent-record.js";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineCall } from "../operations/engine-call.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import type { ConfigJournal } from "../ports.js";
import {
  type RescueCeilingsOptions,
  resignRescueCeilings,
  saveInCeilings,
  settleRescueCeilings,
} from "../safety/rescue-ceilings.js";
import { addressRefusal, walletCheck } from "./address-checks.js";
import { saveForDestination } from "./destination-ceilings.js";
import type { DestinationChain } from "./destination-chain.js";
import { type SavedAccount, savedAccountOf } from "./saved-account.js";

/** What saving an address reads, writes and journals through. */
export interface AddAddressOptions extends RescueCeilingsOptions {
  readonly journal: ConfigJournal;
  readonly ids: IdSource;
  /**
   * The chains a bridge delivers to, where an address may be saved besides the wallets' chains
   * (decision 0297); none when absent.
   */
  readonly destinations?: readonly DestinationChain[];
}

type AddressEntryView = ResultOf<"address/add">;

/**
 * An address book entry as the address book operations answer it, marked `noRoute` when it was
 * saved for a destination chain no bridge rule of the agent's wallets reaches yet (decision 0313).
 */
export function addressEntryView(
  entry: AddressEntryRecord,
  reach: { readonly noRoute: boolean } = { noRoute: false },
): AddressEntryView {
  return {
    entry: entry.id,
    agent: entry.agentId,
    address: entry.account,
    label: entry.label,
    usableAt: entry.usableAtMs,
    ...(entry.inCeilingAtMs === undefined ? {} : { inCeilingAt: entry.inCeilingAtMs }),
    createdAt: entry.createdAtMs,
    ...(reach.noRoute ? { noRoute: true as const } : {}),
  };
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
  saving: { readonly saved: SavedAccount; readonly name: string; readonly noRoute: boolean },
): Promise<Result<AddressEntryView, ProtocolErrorCode>> {
  const atMs = options.clock.now();
  const { account, recipientBytes } = saving.saved;
  const entry: AddressEntryRecord = {
    id: options.ids.next("adr"),
    agentId: call.args.agent,
    account,
    recipientBytes,
    label: call.args.label,
    usableAtMs: atMs + looseningWaitMs,
    inCeilingAtMs: atMs,
    createdAtMs: atMs,
  };
  const added = await options.agents.addAddress(entry, { signal: call.signal });
  if (!added.ok) {
    return savedEntry(options, call, account);
  }
  await record(options, call, { entry: added.value, name: saving.name });
  return ok(addressEntryView(added.value, { noRoute: saving.noRoute }));
}

// The account the call names, checked as it may be saved: its chain, its form, and the refusals
// that need no read on chain.
async function checkedAccount(
  options: AddAddressOptions,
  call: EngineCall<"address/add">,
  settings: AgentSettings,
): Promise<Result<SavedAccount, ProtocolErrorCode>> {
  const parts = { chains: options.chains, destinations: options.destinations ?? [] };
  const saved = savedAccountOf(parts, call.args);
  if (!saved.ok) {
    return saved;
  }
  const facts = await options.install.read({ signal: call.signal });
  const mostPerChain = options.ceilings.mostPerChain;
  const checks = { ...parts, mostPerChain, nowMs: options.clock.now() };
  const refusal = addressRefusal(checks, { saved: saved.value, facts, settings });
  // A full chain refuses only a new entry: one the book holds is answered as it is.
  const held = settings.addressBook.some((entry) => entry.account === saved.value.account);
  return refusal === undefined || (held && refusal === "address.chain_full") ? saved : err(refusal);
}

/**
 * Saves an address in an agent's address book with the owner key (spec 5, section 4; decisions
 * 0091 and 0313): first in the ceiling of each of the agent's live wallets, then in the book,
 * journaled and pushed as `config/changed`; while a new rescue address waits, the owner key signs
 * its changes again over the ceilings as they list now. An address on a chain of the agent's
 * wallets joins the send rules of that chain; one on a destination chain joins the bridge rules
 * that reach it, as each wallet's call rules are written again. Send level 2 lets a send pay it
 * from 24 hours after it was saved (decision 0111). An address the book holds already is answered
 * as it is, and nothing changes. The owner key reaches this call over IPC only, as the protocol
 * server keeps it; a wrong one is `wallet.bad_owner_key`. Its chain and form are checked first
 * (see `savedAccountOf`), then the refusals of `addressRefusal`, then, on Solana, the account is
 * read: a program or a token account is `address.not_wallet` (decision 0298). A ceiling custody
 * does not hold is `wallet.not_found`.
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
  const checked = await checkedAccount(options, call, found.value);
  if (!checked.ok) {
    return checked;
  }
  const saved = checked.value;
  const held = found.value.addressBook.find((entry) => entry.account === saved.account);
  if (held !== undefined) {
    return ok(addressEntryView(held));
  }
  const isWallet = await walletCheck(saved, signal);
  if (!isWallet.ok) {
    return isWallet;
  }
  await settleRescueCeilings(options, signal);
  const facts = await options.install.read({ signal });
  const ownerKey = createSecret(args.ownerKey);
  const move = { facts, agent: args.agent, account: saved.account, ownerKey, signal };
  const inCeiling = saved.isWalletChain
    ? await saveInCeilings(options, move)
    : await saveForDestination(options, {
        ...move,
        record: found.value.agent,
        author: authorOf(call.caller),
      });
  if (!inCeiling.ok) {
    return inCeiling;
  }
  const after = inCeiling.value ?? [];
  const noRoute =
    !saved.isWalletChain && !after.some(({ read }) => read.bridged.includes(saved.account));
  const name = found.value.agent.name;
  const stored = await storeEntry(options, call, { saved, name, noRoute });
  // A refusal here keeps the changes signed before; custody refuses them once due, and says so.
  await resignRescueCeilings(options, ownerKey, signal);
  return stored;
}
