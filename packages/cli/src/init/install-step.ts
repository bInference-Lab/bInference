import { createIdSource, type Id, jsonValueSchema, ok } from "@binference/core";
import type { AccessStore, AgentDraft, AgentStore } from "@binference/engine";
import {
  type InstallSetup,
  type InstallStore,
  makeAgentWorkspace,
  type WalletDraft,
  type WalletRole,
} from "@binference/engine/install";
import { issueStartCode, type StartCode } from "@binference/telegram";
import { stateWorkspace } from "../compose/state-workspace.js";
import { type InitContext, type InitStep, refused } from "./init-context.js";
import type { RescueAddress } from "./rescue-step.js";
import type { FirstWallet } from "./wallet-step.js";

/** The engine database's stores init writes to. */
export interface InitStores {
  readonly install: InstallStore;
  readonly agents: AgentStore;
  readonly access: AccessStore;
}

/** What init records about the install once the wallet is made. */
export interface InstallRecord {
  /** The agent the wallet belongs to. */
  readonly agent: Id<"agt">;
  readonly appId: string;
  readonly ownerKey: string;
  /** The sealing key's public half, when the owner key was made here. */
  readonly sealKey?: string;
  readonly agentKey: string;
  readonly rescue: RescueAddress;
  readonly first: FirstWallet;
  /** The ceiling's cap per contract call on the first chain, in native base units. */
  readonly perTxNativeBase: bigint;
  /** `launch` when the first wallet is a launch wallet a rebuild found (decision 0217). */
  readonly role?: WalletRole;
}

/** The first wallet's label in the engine's records. */
const walletLabel = "main";

/** The first agent to make when the install has none, and the owner's timezone its files name. */
export interface FirstAgent {
  readonly draft: AgentDraft;
  readonly timeZone: string;
}

// The agent's workspace files from their templates, in the state folder; a file there is kept.
async function makeWorkspace(context: InitContext, first: FirstAgent): Promise<void> {
  const { id, name, locale } = first.draft;
  const workspace = { agent: id, name, locale, timeZone: first.timeZone };
  await makeAgentWorkspace(stateWorkspace(context.platform), workspace, context.signal);
}

/**
 * The install's first active agent, or the drafted one made when the install has none, with its
 * workspace files made from their templates in the owner's language, so a run that stopped after
 * making the agent finds it again.
 */
export async function ensureFirstAgent(
  context: InitContext,
  stores: InitStores,
  first: FirstAgent,
): Promise<InitStep<Id<"agt">>> {
  const call = { signal: context.signal };
  const active = (await stores.agents.list(call)).find((agent) => agent.archivedAtMs === undefined);
  if (active !== undefined) {
    return ok(active.id);
  }
  const created = await stores.agents.create(first.draft, call);
  if (!created.ok) {
    return refused("init.agent_name_taken", "refused.agentNameTaken", { name: first.draft.name });
  }
  await makeWorkspace(context, first);
  return ok(created.value.agent.id);
}

/** A wallet Privy holds, as the install store keeps it under an agent. */
export interface WalletEntry {
  readonly agent: Id<"agt">;
  readonly first: FirstWallet;
  /** The ceiling's cap per contract call on the first chain, in native base units. */
  readonly perTxNativeBase: bigint;
  readonly label: string;
  /** `launch` for a launch wallet (decision 0217); absent for an agent wallet. */
  readonly role?: WalletRole;
}

/** The store's draft of a wallet Privy holds, with a new id and its ceiling as read now. */
export function walletDraftOf(context: InitContext, entry: WalletEntry): WalletDraft {
  const atMs = context.host.clock.now();
  const ids = createIdSource({ clock: context.host.clock, random: context.host.random });
  const { first } = entry;
  return {
    id: ids.next("wal"),
    agentId: entry.agent,
    family: "evm",
    custody: "privy",
    custodyWalletId: first.wallet.id,
    policyId: first.policy.id,
    signerId: first.agentQuorum,
    address: first.wallet.address,
    label: entry.label,
    createdAtMs: atMs,
    ceiling: {
      policyId: first.policy.id,
      policy: jsonValueSchema.parse(first.policy),
      perTxNativeBase: entry.perTxNativeBase,
      readAtMs: atMs,
    },
    ...(entry.role === undefined ? {} : { role: entry.role }),
  };
}

function setupOf(context: InitContext, record: InstallRecord): InstallSetup {
  const atMs = context.host.clock.now();
  const { first } = record;
  return {
    atMs,
    custody: {
      provider: "privy",
      appId: record.appId,
      ownerQuorumId: first.ownerQuorum,
      ownerKeyPublic: record.ownerKey,
      agentQuorumId: first.agentQuorum,
      agentKeyPublic: record.agentKey,
      attachedAtMs: atMs,
      ...(record.sealKey === undefined ? {} : { sealKeyPublic: record.sealKey }),
    },
    rescueAddress: record.rescue.account,
    wallet: walletDraftOf(context, { ...record, label: walletLabel }),
    isStartOver: context.flags.isStartOver,
  };
}

/**
 * Records the setup in `engine.sqlite` (database spec, section 2) in one write: the custody, the
 * rescue address, and the wallet with its ceiling, archiving the wallets of an earlier setup when
 * the owner starts over.
 */
export async function recordInstall(
  context: InitContext,
  stores: InitStores,
  record: InstallRecord,
): Promise<InitStep<undefined>> {
  const set = await stores.install.setUp(setupOf(context, record), { signal: context.signal });
  return set.ok
    ? ok(undefined)
    : refused("init.already_set_up", "refused.alreadySetUp", {
        folder: context.platform.stateFolder.root,
      });
}

/** Issues the start code of the owner's bot and answers its link, shown once. */
export async function issuePairing(
  context: InitContext,
  stores: InitStores,
  botUsername: string,
): Promise<StartCode> {
  const { host } = context;
  return issueStartCode(
    { access: stores.access, clock: host.clock, random: host.random, botUsername },
    { signal: context.signal },
  );
}
