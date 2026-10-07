import { createIdSource, type Id, jsonValueSchema, ok } from "@binference/core";
import type { AccessStore, AgentDraft, AgentStore } from "@binference/engine";
import type { InstallSetup, InstallStore } from "@binference/engine/install";
import { issueStartCode, type StartCode } from "@binference/telegram";
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
  readonly agentKey: string;
  readonly rescue: RescueAddress;
  readonly first: FirstWallet;
  /** The ceiling's cap per contract call on the first chain, in native base units. */
  readonly perTxNativeBase: bigint;
}

/** The first wallet's label in the engine's records. */
const walletLabel = "main";

/**
 * The install's first active agent, or the drafted one made when the install has none, so a run
 * that stopped after making the agent finds it again.
 */
export async function ensureFirstAgent(
  context: InitContext,
  stores: InitStores,
  draft: AgentDraft,
): Promise<InitStep<Id<"agt">>> {
  const call = { signal: context.signal };
  const active = (await stores.agents.list(call)).find((agent) => agent.archivedAtMs === undefined);
  if (active !== undefined) {
    return ok(active.id);
  }
  const created = await stores.agents.create(draft, call);
  return created.ok
    ? ok(created.value.agent.id)
    : refused("init.agent_name_taken", "refused.agentNameTaken", { name: draft.name });
}

function setupOf(context: InitContext, record: InstallRecord): InstallSetup {
  const atMs = context.host.clock.now();
  const ids = createIdSource({ clock: context.host.clock, random: context.host.random });
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
    },
    rescueAddress: record.rescue.account,
    wallet: {
      id: ids.next("wal"),
      agentId: record.agent,
      family: "evm",
      custody: "privy",
      custodyWalletId: first.wallet.id,
      policyId: first.policy.id,
      signerId: first.agentQuorum,
      address: first.wallet.address,
      label: walletLabel,
      createdAtMs: atMs,
      ceiling: {
        policyId: first.policy.id,
        policy: jsonValueSchema.parse(first.policy),
        perTxNativeBase: record.perTxNativeBase,
        readAtMs: atMs,
      },
    },
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
