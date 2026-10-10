import { type Id, ok } from "@binference/core";
import type { OwnerAuthorize } from "@binference/custody-privy";
import type { CustodyRecord, InstallStore } from "@binference/engine/install";
import { loadConfig } from "../config/load-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { UnlockConfig, UnlockMode } from "../config/schema/engine.schema.js";
import { type AgentKey, takeAgentKey } from "../init/agent-key-step.js";
import { type InitContext, type InitStep, type Refused, refused } from "../init/init-context.js";
import { systemDefaults } from "../program/system-defaults.js";
import { type AttachApp, takeAttachApp } from "./attach-app.js";
import { takeAttachBot } from "./attach-bot.js";
import { takeOwnerKey } from "./attach-owner-key.js";
import { type MovedSigners, moveSigners } from "./attach-signers.js";
import { movedSources, moveSources } from "./moved-sources.js";

/** What an attach did, for its summary. */
export interface AttachOutcome {
  /** How many live wallets this machine now signs for. */
  readonly wallets: number;
  /** Privy's id of the key quorum of this machine's agent key: its signer ID. */
  readonly signer: string;
  /** The signers the wallets had before, which sign nothing more. */
  readonly removed: readonly string[];
  readonly unlockMode: UnlockMode;
  /** False when the unlock mode held a key from an earlier attach that stopped part way. */
  readonly isAgentKeyNew: boolean;
  /** Whether this machine reads the bot token; without it the engine starts without the bot. */
  readonly hasBot: boolean;
}

// The install's config as `binference start` loads it, its secret sources moved first when they
// name the old machine's `keys/` (decision 0142); one that does not load stops attach.
async function configOf(context: InitContext): Promise<InitStep<BinferenceConfig>> {
  const loaded = await loadedConfig(context);
  const moves = loaded.ok ? movedSources(context, loaded.value) : [];
  if (!loaded.ok || moves.length === 0) {
    return loaded;
  }
  const moved = await moveSources(context, moves);
  return moved.ok ? loadedConfig(context) : moved;
}

async function loadedConfig(context: InitContext): Promise<InitStep<BinferenceConfig>> {
  const { host, platform, signal } = context;
  const loaded = await loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets: [],
    system: systemDefaults(host.env, platform),
    signal,
  });
  return loaded.ok
    ? ok(loaded.config)
    : refused("init.attach_config", "refused.attachConfig", { folder: platform.stateFolder.root });
}

/** What attach checked and made before it changes anything on Privy. */
interface Checked {
  readonly app: AttachApp;
  readonly authorize: OwnerAuthorize;
  readonly agentKey: AgentKey;
  readonly unlock: UnlockConfig;
  /** Whether the bot token is where config.json5 names it, or was typed and kept there. */
  readonly hasBot: boolean;
}

// The key the wallets name now, in the folder the unlock mode reads: a copy of the old `keys/`
// in the modes that keep it there, or a machine attached already.
function heldCurrentKey(context: InitContext, unlock: UnlockConfig): Refused {
  const keys = context.platform.stateFolder.keys;
  return unlock.mode === "file" || unlock.mode === "manual"
    ? refused("init.attach_copied_keys", "refused.attachCopiedKeys", { folder: keys })
    : refused("init.attached_already", "refused.attachedAlready");
}

async function check(
  context: InitContext,
  found: { readonly custody: CustodyRecord; readonly installId: Id<"ins"> },
): Promise<InitStep<Checked>> {
  const config = await configOf(context);
  if (!config.ok) {
    return config;
  }
  const app = await takeAttachApp(context, config.value, found.custody);
  if (!app.ok) {
    return app;
  }
  const hasBot = await takeAttachBot(context, config.value);
  const authorize = await takeOwnerKey(context, found.custody.ownerKeyPublic);
  if (!authorize.ok) {
    return authorize;
  }
  const { unlock } = config.value.engine;
  const agentKey = await takeAgentKey(context, unlock, found.installId);
  if (!agentKey.ok) {
    return agentKey;
  }
  return agentKey.value.publicKey === found.custody.agentKeyPublic
    ? heldCurrentKey(context, unlock)
    : ok({ app: app.value, authorize: authorize.value, agentKey: agentKey.value, unlock, hasBot });
}

async function attachWith(
  context: InitContext,
  install: InstallStore,
  found: { readonly custody: CustodyRecord; readonly installId: Id<"ins"> },
): Promise<InitStep<AttachOutcome>> {
  const checked = await check(context, found);
  if (!checked.ok) {
    return checked;
  }
  const { app, authorize, agentKey, unlock, hasBot } = checked.value;
  const { wallets } = await install.read({ signal: context.signal });
  const live = wallets.filter((wallet) => wallet.archivedAtMs === undefined);
  const moved = await moveSigners(context, {
    ...app,
    authorize,
    agentKey: agentKey.publicKey,
    wallets: live,
  });
  if (!moved.ok) {
    return moved;
  }
  await record(context, install, { moved: moved.value, agentKey });
  return ok({
    wallets: live.length,
    ...moved.value,
    unlockMode: unlock.mode,
    isAgentKeyNew: agentKey.isNew,
    hasBot,
  });
}

// Records the new agent key as the custody's and every live wallet's signer, in one write.
async function record(
  context: InitContext,
  install: InstallStore,
  done: { readonly moved: MovedSigners; readonly agentKey: AgentKey },
): Promise<void> {
  const attachment = {
    agentQuorumId: done.moved.signer,
    agentKeyPublic: done.agentKey.publicKey,
    atMs: context.host.clock.now(),
  };
  await install.attach(attachment, { signal: context.signal });
}

/**
 * Runs `binference init --attach` once its database is open (keys spec, section 6; decision
 * 0140): on a folder that holds the install, it checks the install's config and Privy app, takes
 * the owner key unseen, makes this machine's agent key where the unlock mode keeps it, makes that
 * key each live wallet's one signer on Privy in a change the owner key signs, which removes the
 * signer it had, and records the key in `engine.sqlite`. A folder with no install stops it, since
 * how a new machine receives an install is not decided yet. Nothing changes on Privy before the
 * owner key is checked, and a machine that holds the wallets' key already changes nothing.
 */
export async function runAttach(
  context: InitContext,
  install: InstallStore,
  installId: Id<"ins">,
): Promise<InitStep<AttachOutcome>> {
  const { custody } = await install.read({ signal: context.signal });
  if (custody === undefined) {
    return refused("init.attach_needs_install", "refused.attachNeedsInstall", {
      folder: context.platform.stateFolder.root,
    });
  }
  return attachWith(context, install, { custody, installId });
}
