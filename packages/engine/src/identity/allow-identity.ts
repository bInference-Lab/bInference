import { createSecret, err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { authorOf } from "../audit/journal-config-change.js";
import {
  announceRewrite,
  type HeldCeiling,
  readCeilings,
  refreshCeilings,
} from "../ceilings/ceiling-rewrite.js";
import { venuesIn } from "../ceilings/ceiling-view-of.js";
import { callsRefusalCodes } from "../ceilings/set-ceiling.js";
import type { WalletRecord } from "../install/install-record.js";
import { defaultWalletIn } from "../install/role-wallet.js";
import { callsOutsideCeiling } from "../limits/limit-ceiling.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineCall } from "../operations/engine-call.js";
import type { ConfigJournal } from "../ports.js";
import { ownerKeyRewrite, type RescueCeilingsOptions } from "../safety/rescue-ceilings.js";
import { ceilingRecipients } from "../safety/wallet-recipients.js";
import type { IdentityHost } from "./identity-host.js";
import type { IdentityStore } from "./ports.js";

/** What an agent's opt-in to an identity reads, asks custody, journals and announces through. */
export interface AllowIdentityOptions extends RescueCeilingsOptions {
  readonly journal: ConfigJournal;
  readonly identity: IdentityHost;
  readonly identities: IdentityStore;
}

type Call = EngineCall<"identity/allow">;

// The agent's main wallet, the one a registration signs from: its first live wallet with no role.
function mainWalletOf(
  wallets: readonly WalletRecord[],
  agent: Id<"agt">,
): WalletRecord | undefined {
  const owned = wallets
    .filter((wallet) => wallet.agentId === agent && wallet.archivedAtMs === undefined)
    .map((wallet) => wallet.id);
  const main = defaultWalletIn(wallets, owned);
  return wallets.find((wallet) => wallet.id === main);
}

// The main wallet's ceiling written again with the registry's call beside the venues it holds, in
// the install's line of owner key writes, then read back, journaled and announced as `ceiling set`
// announces a change.
async function writeRegistryCall(
  options: AllowIdentityOptions,
  call: Call,
  held: { readonly settings: AgentSettings; readonly before: HeldCeiling; readonly venue: string },
): Promise<Result<void, ProtocolErrorCode>> {
  const { signal } = call;
  const { settings, before, venue } = held;
  const { wallet, read } = before;
  const most = options.ceilings.mostPerChain;
  const recipients = await ceilingRecipients({ ...options, most }, signal);
  const ceilings = [
    {
      ceiling: wallet.policyId,
      venues: [...new Set([...venuesIn(options.chains, read), venue])],
      perTxNativeBase: read.perTxNativeBase,
      recipients: recipients.get(wallet.policyId) ?? [],
    },
  ];
  const ownerKey = createSecret(call.args.ownerKey);
  const set = await options.ceilings.setCalls({ ownerKey, ceilings }, { signal });
  if (!set.ok && set.error === "bad_owner_key") {
    return err(callsRefusalCodes[set.error]);
  }
  const after = await refreshCeilings(options, [wallet], signal);
  const moved = { agent: settings.agent, author: authorOf(call.caller), signal };
  await announceRewrite(options, moved, { before: [before], after });
  return set.ok ? ok(undefined) : err(callsRefusalCodes[set.error]);
}

/**
 * The owner's opt-in to an identity (decision 0335): with the owner key over IPC, it adds the
 * identity registry's one call to the ceiling of the agent's main wallet, the wallet a
 * registration signs from, and nothing else of any wallet. A ceiling that holds the call already
 * is left as it is; else the write runs as `ceiling set` runs one and is read back, journaled and
 * announced. It answers the main wallet and whether its ceiling changed. No registry is
 * `intent.kind_unavailable`, an agent whose identity binference holds `intent.identity_exists`, no
 * main wallet or a ceiling custody does not hold `wallet.not_found`, a wrong key
 * `wallet.bad_owner_key`.
 */
export async function allowIdentity(
  options: AllowIdentityOptions,
  call: Call,
): Promise<Result<{ readonly wallet: Id<"wal">; readonly changed: boolean }, ProtocolErrorCode>> {
  const { args, signal } = call;
  const found = await activeAgent(options.agents, args.agent, { signal });
  if (!found.ok) {
    return found;
  }
  const [registry] = options.identity.registries;
  if (registry === undefined) {
    return err("intent.kind_unavailable");
  }
  if ((await options.identities.get(args.agent, { signal })) !== undefined) {
    return err("intent.identity_exists");
  }
  const { wallets } = await options.install.read({ signal });
  const main = mainWalletOf(wallets, args.agent);
  if (
    main !== undefined &&
    callsOutsideCeiling(main, options.identity.callsOf(registry)).length === 0
  ) {
    return ok({ wallet: main.id, changed: false });
  }
  const [before] = main === undefined ? [] : await readCeilings(options, [main], signal);
  if (main === undefined || before === undefined) {
    return err("wallet.not_found");
  }
  const held = { settings: found.value, before, venue: registry.id };
  const ownerKey = createSecret(args.ownerKey);
  const written = await ownerKeyRewrite(options, { ownerKey, signal }, async () =>
    writeRegistryCall(options, call, held),
  );
  return written.ok ? ok({ wallet: main.id, changed: true }) : written;
}
