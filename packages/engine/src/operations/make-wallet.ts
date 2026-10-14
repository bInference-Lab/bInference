import type { AccountRef } from "@binference/chain";
import {
  createSecret,
  err,
  type IdSource,
  jsonValueSchema,
  ok,
  type Result,
} from "@binference/core";
import type { ProtocolErrorCode, WalletView } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import type { WalletDraft } from "../install/install-record.js";
import type { WalletMaker } from "../install/ports.js";
import type { WalletRefusal } from "../install/wallet-request.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { ConfigJournal } from "../ports.js";
import {
  type RescueCeilingsOptions,
  resignRescueCeilings,
  settleRescueCeilings,
} from "../safety/rescue-ceilings.js";
import { activeAgent } from "./active-agent.js";
import type { EngineCall } from "./engine-call.js";

/** What making a wallet reads, writes, journals and asks custody through. */
export interface MakeWalletOptions extends RescueCeilingsOptions {
  readonly maker: WalletMaker;
  readonly journal: ConfigJournal;
  readonly ids: IdSource;
}

// Whether the agent holds a live launch wallet already: it holds one at most (decision 0217).
async function hasLaunchWallet(
  options: MakeWalletOptions,
  agent: AgentSettings["agent"]["id"],
  signal: AbortSignal,
): Promise<boolean> {
  const { wallets } = await options.install.read({ signal });
  return wallets.some(
    (wallet) =>
      wallet.agentId === agent && wallet.role === "launch" && wallet.archivedAtMs === undefined,
  );
}

const refusalCodes: Readonly<Record<WalletRefusal, ProtocolErrorCode>> = {
  bad_owner_key: "wallet.bad_owner_key",
  bad_recipients: "protocol.bad_args",
};

// The rescue address in effect, a new one that waits, and the agent's saved addresses.
async function recipientsOf(
  options: MakeWalletOptions,
  settings: AgentSettings,
  signal: AbortSignal,
): Promise<Result<readonly AccountRef[], ProtocolErrorCode>> {
  const facts = await options.install.read({ signal });
  const { rescueAddress, pendingRescue } = rescueAt(facts, options.clock.now());
  if (rescueAddress === undefined) {
    return err("rescue.no_address");
  }
  const saved = settings.addressBook
    .filter((entry) => entry.inCeilingAtMs !== undefined)
    .map((entry) => entry.account);
  const waiting = pendingRescue === undefined ? [] : [pendingRescue.address];
  return ok([...new Set([rescueAddress, ...waiting, ...saved])]);
}

async function record(
  options: MakeWalletOptions,
  call: EngineCall<"wallet/create">,
  made: { readonly view: WalletView; readonly name: string },
): Promise<void> {
  await journalConfigChange(
    options,
    {
      author: authorOf(call.caller),
      atMs: made.view.createdAt,
      path: `agents.${made.name}.wallets.${made.view.wallet}`,
      after: jsonValueSchema.parse(made.view),
    },
    { signal: call.signal },
  );
}

/**
 * Makes a new wallet for an agent with the owner key (spec 5, section 2; decision 0130): custody
 * makes it under a ceiling of its own, which lets it call the registry contracts of the agent's
 * venues and send only to the rescue address in effect, a new one that waits and the agent's saved
 * addresses. The install store then holds it beside the agent's other wallets, journaled and
 * pushed as `config/changed`; while a new rescue address waits, the owner key signs its changes
 * again over every ceiling, the new one too. With `launch`, the wallet is the agent's launch wallet,
 * whose ceiling also allows the calls the install's launchpads declare on each launch's own
 * contracts (decision 0217); an agent with a live one already is `wallet.launch_exists`. The owner
 * key reaches this call over IPC only, as the protocol server keeps it. No rescue address is
 * `rescue.no_address`, a wrong key `wallet.bad_owner_key`; nothing is made then.
 */
export async function makeWallet(
  options: MakeWalletOptions,
  call: EngineCall<"wallet/create">,
): Promise<Result<WalletView, ProtocolErrorCode>> {
  const { args, signal } = call;
  const found = await activeAgent(options.agents, args.agent, { signal });
  if (!found.ok) {
    return found;
  }
  const isLaunch = args.launch === true;
  if (isLaunch && (await hasLaunchWallet(options, args.agent, signal))) {
    return err("wallet.launch_exists");
  }
  await settleRescueCeilings(options, signal);
  const recipients = await recipientsOf(options, found.value, signal);
  if (!recipients.ok) {
    return recipients;
  }
  const ownerKey = createSecret(args.ownerKey);
  const wallet = options.ids.next("wal");
  const venues = found.value.limits.venues;
  const request = { wallet, ownerKey, venues, recipients: recipients.value, isLaunch };
  const made = await options.maker.make(request, { signal });
  if (!made.ok) {
    return err(refusalCodes[made.error]);
  }
  const createdAtMs = options.clock.now();
  const draft: WalletDraft = {
    ...made.value.record,
    id: wallet,
    agentId: args.agent,
    label: args.label,
    createdAtMs,
    ...(isLaunch ? { role: "launch" } : {}),
  };
  await options.install.createWallet(draft, { signal });
  // A refusal here keeps the changes signed before; custody refuses them once due, and says so.
  await resignRescueCeilings(options, ownerKey, signal);
  const view: WalletView = {
    wallet,
    agent: args.agent,
    address: made.value.account,
    label: args.label,
    createdAt: createdAtMs,
    ...(isLaunch ? { role: "launch" } : {}),
  };
  await record(options, call, { view, name: found.value.agent.name });
  return ok(view);
}
