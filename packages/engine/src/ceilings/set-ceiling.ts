import type { AccountRef, ChainRef, ChainRegistry } from "@binference/chain";
import { type Clock, createSecret, err, ok, type Result } from "@binference/core";
import {
  type CeilingChanges,
  type CeilingView,
  type ProtocolErrorCode,
} from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { authorOf } from "../audit/journal-config-change.js";
import type { CallsRefusal, CeilingCalls } from "../install/ceiling-change.js";
import type { WalletRecord } from "../install/install-record.js";
import type { CeilingEditor } from "../install/ports.js";
import { unknownVenues } from "../limits/limit-ceiling.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineCall } from "../operations/engine-call.js";
import type { AgentStore, ConfigJournal, InstallStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { ceilingRecipients } from "../safety/wallet-recipients.js";
import {
  announceRewrite,
  type HeldCeiling,
  isSameSet,
  readCeilings,
  refreshCeilings,
} from "./ceiling-rewrite.js";
import { ceilingViewOf, venuesIn } from "./ceiling-view-of.js";

/** What a ceiling change reads, asks custody, writes, journals and announces through. */
export interface SetCeilingOptions {
  readonly agents: AgentStore;
  readonly install: InstallStore;
  readonly ceilings: CeilingEditor;
  readonly journal: ConfigJournal;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

type Call = EngineCall<"ceiling/set">;

/** The protocol error code of each way custody refuses a change of calls. */
export const callsRefusalCodes: Readonly<Record<CallsRefusal, ProtocolErrorCode>> = {
  bad_owner_key: "wallet.bad_owner_key",
  bad_recipients: "address.chain_full",
  not_found: "wallet.not_found",
  no_calls: "protocol.bad_args",
  no_bridge_calls: "wallet.no_bridge_calls",
  too_large: "wallet.ceiling_too_large",
  bad_bridge: "wallet.ceiling_bad_bridge",
  uncapped_token: "wallet.ceiling_uncapped",
};

function isCapsChange(changes: CeilingChanges): boolean {
  return changes.dayCapUsdMicros !== undefined;
}

// 24-hour caps come alone, above 0.
function capsRefusal(changes: CeilingChanges): ProtocolErrorCode | undefined {
  const { chains, venues, perTxNative, dayCapUsdMicros = 0n } = changes;
  const isAlone = chains === undefined && venues === undefined && perTxNative === undefined;
  return isAlone && dayCapUsdMicros > 0n ? undefined : "protocol.bad_args";
}

// A chain change, venues none or unknown, a venue removed that the limits in effect or waiting
// still name, or 24-hour caps that are not above 0 or come with another change; undefined when
// the changes may apply to every ceiling.
function refusalOf(
  options: SetCeilingOptions,
  planned: {
    readonly changes: CeilingChanges;
    readonly held: readonly HeldCeiling[];
    readonly settings: AgentSettings;
  },
): ProtocolErrorCode | undefined {
  const { changes, held, settings } = planned;
  const { chains, venues } = changes;
  if (isCapsChange(changes)) {
    return capsRefusal(changes);
  }
  const isChainChange = (enabled: readonly ChainRef[]) =>
    chains !== undefined && !isSameSet(enabled, chains);
  if (held.some((item) => isChainChange(item.read.chains))) {
    return "protocol.bad_args";
  }
  if (venues === undefined) {
    return undefined;
  }
  if (venues.length === 0 || unknownVenues(options.chains, venues).length > 0) {
    return "protocol.bad_args";
  }
  const { limits } = settings;
  const named = new Set([...limits.venues, ...(limits.pending?.values.venues ?? [])]);
  const removed = held.flatMap((item) =>
    venuesIn(options.chains, item.read).filter((venue) => !venues.includes(venue)),
  );
  return removed.some((venue) => named.has(venue)) ? "limit.venue_in_use" : undefined;
}

// What each ceiling's calls become: the venues, cap and 24-hour caps asked, else the ones it holds;
// a wallet with a role keeps that role's rules, as a launch wallet its launch rules (decision 0217).
function callsOf(
  options: SetCeilingOptions,
  change: {
    readonly changes: CeilingChanges;
    readonly held: readonly HeldCeiling[];
    readonly recipients: ReadonlyMap<string, readonly AccountRef[]>;
  },
): readonly CeilingCalls[] {
  const { changes, held, recipients } = change;
  const { dayCapUsdMicros } = changes;
  // A ceiling that allows no call names no cap, so a change of the caps leaves it as it is.
  const changed =
    dayCapUsdMicros === undefined ? held : held.filter(({ read }) => read.dayCaps.length > 0);
  const resize = dayCapUsdMicros === undefined ? {} : { dayCapUsdMicros };
  return changed.map(({ wallet, read }) =>
    Object.assign(
      {
        ceiling: wallet.policyId,
        venues: [...new Set(changes.venues ?? venuesIn(options.chains, read))],
        perTxNativeBase: changes.perTxNative ?? read.perTxNativeBase,
      },
      resize,
      wallet.role === undefined ? {} : { role: wallet.role },
      { recipients: recipients.get(wallet.policyId) ?? [] },
    ),
  );
}

// The live wallet the call names, its agent, and every live wallet of that agent.
async function walletsOf(
  options: SetCeilingOptions,
  call: Call,
): Promise<
  Result<
    { readonly settings: AgentSettings; readonly wallets: readonly WalletRecord[] },
    ProtocolErrorCode
  >
> {
  const { wallets } = await options.install.read({ signal: call.signal });
  const live = wallets.filter((wallet) => wallet.archivedAtMs === undefined);
  const named = live.find((wallet) => wallet.id === call.args.wallet);
  if (named === undefined) {
    return err("wallet.not_found");
  }
  const found = await activeAgent(options.agents, named.agentId, { signal: call.signal });
  // The 24-hour caps are the install's: a change of them reaches every live wallet.
  const changed = isCapsChange(call.args.changes)
    ? live
    : live.filter((wallet) => wallet.agentId === named.agentId);
  return found.ok ? ok({ settings: found.value, wallets: changed }) : found;
}

/**
 * Changes what the ceiling of every live wallet of an agent lets a contract call do, with the
 * owner key over IPC (decision 0132): the venues whose registry contracts it may reach and the
 * most native coin one call may carry, on the chains each ceiling enables. A change of the 24-hour
 * caps comes alone, above 0, and resizes the caps of every live wallet of the install, whose sums
 * they share (decision 0151); any other is `protocol.bad_args`. Its chains and send recipients
 * stay: naming other chains is `protocol.bad_args`, as a new chain needs a new wallet. Its bridge
 * rules pay again the addresses saved for each destination (decision 0313).
 * No venue or an unknown one is `protocol.bad_args`; removing a venue the agent's limits name, in
 * effect or waiting, is `limit.venue_in_use`; a wrong key is `wallet.bad_owner_key`. Each wallet's
 * stored copy of its ceiling is then read back from custody; a change that moved one is
 * journaled, pushed as `config/changed`, and announced as the `notice.ceilingChange` notice. It
 * answers the named wallet's ceiling as custody holds it after the change.
 */
export async function setCeiling(
  options: SetCeilingOptions,
  call: Call,
): Promise<Result<CeilingView, ProtocolErrorCode>> {
  const { args, signal } = call;
  const found = await walletsOf(options, call);
  if (!found.ok) {
    return found;
  }
  const { settings, wallets } = found.value;
  const before = await readCeilings(options, wallets, signal);
  if (before.length < wallets.length) {
    return err("wallet.not_found");
  }
  const refusal = refusalOf(options, { changes: args.changes, held: before, settings });
  if (refusal !== undefined) {
    return err(refusal);
  }
  const most = options.ceilings.mostPerChain;
  const recipients = await ceilingRecipients({ ...options, most }, signal);
  const ceilings = callsOf(options, { changes: args.changes, held: before, recipients });
  const set = await options.ceilings.setCalls(
    { ownerKey: createSecret(args.ownerKey), ceilings },
    { signal },
  );
  if (!set.ok && set.error === "bad_owner_key") {
    return err(callsRefusalCodes[set.error]);
  }
  // A refusal part way may leave earlier ceilings changed: every copy is read back all the same.
  const after = await refreshCeilings(options, wallets, signal);
  const moved = { agent: settings.agent, author: authorOf(call.caller), signal };
  await announceRewrite(options, moved, { before, after });
  const named = after.find((item) => item.wallet.id === args.wallet);
  if (!set.ok || named === undefined) {
    return err(set.ok ? "wallet.not_found" : callsRefusalCodes[set.error]);
  }
  return ok(ceilingViewOf(options.chains, { ...named, wallet: named.wallet.id }));
}
