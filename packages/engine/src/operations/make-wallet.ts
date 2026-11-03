import type { AccountRef, WalletRole } from "@binference/chain";
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
import { roleWalletOf } from "../install/role-wallet.js";
import type { WalletRefusal } from "../install/wallet-request.js";
import type { ConfigJournal } from "../ports.js";
import {
  type RescueCeilingsOptions,
  resignRescueCeilings,
  settleRescueCeilings,
} from "../safety/rescue-ceilings.js";
import { rescueReachOf } from "../safety/rescue-reach.js";
import { rescueAccounts, savedPayees, walletRecipients } from "../safety/wallet-recipients.js";
import type { VenueHost } from "../venues/venue-host.js";
import { activeAgent } from "./active-agent.js";
import type { EngineCall } from "./engine-call.js";
import { roleMarksOf } from "./wallet-view-of.js";

/** What making a wallet reads, writes, journals and asks custody through. */
export interface MakeWalletOptions extends RescueCeilingsOptions {
  readonly maker: WalletMaker;
  /** The calls only a wallet of each role makes on the install's venues, which its ceiling allows. */
  readonly host: Pick<VenueHost, "roleWalletCalls">;
  readonly journal: ConfigJournal;
  readonly ids: IdSource;
}

const refusalCodes: Readonly<Record<WalletRefusal, ProtocolErrorCode>> = {
  bad_owner_key: "wallet.bad_owner_key",
  bad_recipients: "address.chain_full",
  venue_not_run: "wallet.venue_not_run",
};

// The rescue address in effect, a new one that waits, and the agent's saved addresses, none of them
// a launch or bridge wallet's (decisions 0218 and 0307).
async function recipientsOf(
  options: MakeWalletOptions,
  settings: AgentSettings,
  signal: AbortSignal,
): Promise<Result<readonly AccountRef[], ProtocolErrorCode>> {
  const facts = await options.install.read({ signal });
  const rescues = rescueAccounts(facts, options.clock.now());
  if (rescues[0] === undefined) {
    return err("rescue.no_address");
  }
  const saved = savedPayees(settings.addressBook, { facts, chains: options.chains });
  const reach = rescueReachOf(facts, options.ceilings.mostPerChain);
  return ok(walletRecipients({ agent: settings.agent.id, saved }, { rescues, reach }));
}

// Why a wallet of each role is refused: the agent holds a live one, or no venue marks a call only
// such a wallet makes.
const roleRefusals: Readonly<
  Record<WalletRole, { readonly exists: ProtocolErrorCode; readonly noCalls: ProtocolErrorCode }>
> = {
  launch: { exists: "wallet.launch_exists", noCalls: "wallet.no_launch_calls" },
  bridge: { exists: "wallet.bridge_exists", noCalls: "wallet.no_bridge_calls" },
};

// The role the call asks for; asking for two is malformed.
function roleAsked(args: EngineCall<"wallet/create">["args"]): WalletRole | undefined | "both" {
  if (args.launch === true) {
    return args.bridge === true ? "both" : "launch";
  }
  return args.bridge === true ? "bridge" : undefined;
}

// The role the new wallet takes. A wallet of a role needs a venue that marks a call only such a
// wallet makes, such as a create call or a launch call for a launch wallet (decision 0271), or a
// deposit for a bridge wallet (decision 0303), and an agent holds one of each role at most.
async function roleOf(
  options: MakeWalletOptions,
  call: EngineCall<"wallet/create">,
): Promise<Result<WalletRole | undefined, ProtocolErrorCode>> {
  const role = roleAsked(call.args);
  if (role === undefined || role === "both") {
    return role === undefined ? ok(undefined) : err("protocol.bad_args");
  }
  const refusals = roleRefusals[role];
  if (options.host.roleWalletCalls(role).length === 0) {
    return err(refusals.noCalls);
  }
  const asked = { agent: call.args.agent, role };
  const held = await roleWalletOf(options.install, asked, { signal: call.signal });
  return held === undefined ? ok(role) : err(refusals.exists);
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
 * contracts (decision 0217); an agent with a live one already is `wallet.launch_exists`, and an
 * install whose launchpads declare no such call `wallet.no_launch_calls` (decision 0218). With
 * `bridge`, it is the agent's bridge wallet, whose ceiling holds only the deposits the install's
 * venues mark as a bridge wallet's (decision 0307): `wallet.bridge_exists` and
 * `wallet.no_bridge_calls` likewise; both roles at once are `protocol.bad_args`. The owner
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
  const asked = await roleOf(options, call);
  if (!asked.ok) {
    return asked;
  }
  const role = asked.value;
  await settleRescueCeilings(options, signal);
  const recipients = await recipientsOf(options, found.value, signal);
  if (!recipients.ok) {
    return recipients;
  }
  const ownerKey = createSecret(args.ownerKey);
  const wallet = options.ids.next("wal");
  const venues = found.value.limits.venues;
  const roles = role === undefined ? {} : { role };
  const request = { wallet, ownerKey, venues, recipients: recipients.value, ...roles };
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
    ...roles,
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
    ...roleMarksOf(role),
  };
  await record(options, call, { view, name: found.value.agent.name });
  return ok(view);
}
