import { type ChainRef, chainRefSchema } from "@binference/chain";
import { type Id, ok, type Secret } from "@binference/core";
import type { OwnedWallet, PrivyId } from "@binference/custody-privy";
import type { UnlockMode } from "../config/schema/engine.schema.js";
import { type AgentKey, takeAgentKey } from "../init/agent-key-step.js";
import { takeOwnerBot } from "../init/bot-token-step.js";
import { coreVenues, enabledVenues } from "../init/ceiling-request.js";
import type { Answers } from "../init/init-answers.js";
import { unlockOf } from "../init/init-answers.js";
import type { InitConfig } from "../init/init-config.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import {
  ensureFirstAgent,
  type InitStores,
  issuePairing,
  recordInstall,
  walletDraftOf,
} from "../init/install-step.js";
import { takePrivyApp } from "../init/privy-app-step.js";
import { agentDraftOf, configOf, storeTyped, writeConfig } from "../init/run-init.js";
import { secretPlaceOf } from "../init/secret-places.js";
import type { FirstWallet } from "../init/wallet-step.js";
import { type MovedSigners, moveSigners } from "./attach-signers.js";
import { type RebuildOwner, takeRebuildOwner } from "./rebuild-owner.js";
import { takeRebuildRescue } from "./rebuild-rescue.js";

/** What a rebuild made, for its summary. */
export interface RebuildOutcome {
  /** The wallets' addresses, oldest first. */
  readonly addresses: readonly string[];
  readonly rescue: string;
  /** This machine's signer ID, and the signers the wallets had before. */
  readonly moved: MovedSigners;
  readonly unlockMode: UnlockMode;
  readonly isAgentKeyNew: boolean;
  readonly pairingLink: Secret;
  readonly pairingExpiresAtMs: number;
  readonly botUsername: string;
  readonly configFile: string;
}

/** What a rebuild checked and built before it changes anything. */
interface Prepared {
  readonly answers: Answers;
  readonly owner: RebuildOwner;
  readonly built: InitConfig;
}

// The person types the number of wallets found, a word of no language, to go on.
async function confirmed(context: InitContext, count: number): Promise<boolean> {
  const expected = String(count);
  const typed = await context.prompter.ask({
    id: "rebuildConfirm",
    message: context.words("rebuild.confirm", { count }),
  });
  return typed.trim() === expected;
}

async function questions(context: InitContext): Promise<InitStep<Omit<Prepared, "built">>> {
  const unlock = unlockOf(context);
  if (!unlock.ok) {
    return unlock;
  }
  const app = await takePrivyApp(context);
  if (!app.ok) {
    return app;
  }
  const owner = await takeRebuildOwner(context, app.value);
  if (!owner.ok) {
    return owner;
  }
  // Each wallet with the time Privy made it, so one the owner did not make stands out.
  const wallets = owner.value.owned
    .map(({ wallet }) =>
      context.words("rebuild.foundWallet", {
        address: wallet.address,
        made: context.dateTime(wallet.createdAtMs),
      }),
    )
    .join("\n");
  context.prompter.say(
    context.words("rebuild.found", { count: owner.value.owned.length, wallets }),
  );
  const rescue = await takeRebuildRescue(context, owner.value.owned);
  if (!rescue.ok) {
    return rescue;
  }
  if (!(await confirmed(context, owner.value.owned.length))) {
    return refused("init.rebuild_not_confirmed", "refused.rebuildNotConfirmed");
  }
  const bot = await takeOwnerBot(context);
  if (!bot.ok) {
    return bot;
  }
  const place = secretPlaceOf(unlock.value.mode, context.platform);
  const { ownerKey } = owner.value;
  const answers = {
    unlock: unlock.value,
    place,
    app: app.value,
    ownerKey,
    rescue: rescue.value,
    bot: bot.value,
  };
  return ok({ answers, owner: owner.value });
}

async function prepare(context: InitContext): Promise<InitStep<Prepared>> {
  context.prompter.note(context.words("rebuild.warning"), context.words("rebuild.title"));
  const asked = await questions(context);
  if (!asked.ok) {
    return asked;
  }
  const built = await configOf(context, asked.value.answers);
  return built.ok ? ok({ ...asked.value, built: built.value }) : built;
}

// A wallet Privy holds as init's first wallet is recorded: its chains, quorums and ceiling.
function firstOf(owned: OwnedWallet, agentQuorum: PrivyId): FirstWallet {
  const chains: readonly ChainRef[] = owned.ceiling.chainIds.map((id) =>
    chainRefSchema.parse(`eip155:${id}`),
  );
  const { id, address } = owned.wallet;
  return {
    wallet: { id, address, chains },
    ownerQuorum: owned.ownerQuorum,
    agentQuorum,
    policy: owned.policy,
  };
}

// Records the custody, the rescue address and every wallet with its ceiling, in the order Privy
// listed them, agent wallets first: the first as init's first wallet, the others beside it, a
// launch wallet with its role (decision 0217).
async function record(
  context: InitContext,
  stores: InitStores,
  made: {
    readonly prepared: Prepared;
    readonly agent: Id<"agt">;
    readonly agentKey: AgentKey;
    readonly moved: MovedSigners;
  },
): Promise<InitStep<undefined>> {
  const { prepared, agent, agentKey, moved } = made;
  // Agent wallets first, as Privy listed them, so the main wallet is never a launch wallet.
  const listed = prepared.owner.owned.toSorted(
    (left, right) => Number(left.ceiling.isLaunch) - Number(right.ceiling.isLaunch),
  );
  const [first, ...others] = listed.map((owned) =>
    Object.assign(
      { first: firstOf(owned, moved.signer), perTxNativeBase: owned.ceiling.perTxNativeCapBase },
      owned.ceiling.isLaunch ? { role: "launch" as const } : {},
    ),
  );
  if (first === undefined) {
    return refused("init.rebuild_no_wallets", "refused.rebuildNoWallets");
  }
  const { answers } = prepared;
  const recorded = await recordInstall(context, stores, {
    agent,
    appId: answers.app.appId,
    ownerKey: answers.ownerKey.publicKey,
    ...(answers.ownerKey.sealKeyPublic === undefined
      ? {}
      : { sealKey: answers.ownerKey.sealKeyPublic }),
    agentKey: agentKey.publicKey,
    rescue: answers.rescue,
    ...first,
  });
  if (!recorded.ok) {
    return recorded;
  }
  for (const [index, other] of others.entries()) {
    const label = `wallet ${String(index + 2)}`;
    // oxlint-disable-next-line eslint/no-await-in-loop -- wallets keep the order Privy listed them in
    await stores.install.createWallet(walletDraftOf(context, { agent, ...other, label }), {
      signal: context.signal,
    });
  }
  return ok(undefined);
}

async function make(
  context: InitContext,
  stores: InitStores,
  ready: { readonly prepared: Prepared; readonly installId: Id<"ins"> },
): Promise<InitStep<{ readonly agentKey: AgentKey; readonly moved: MovedSigners }>> {
  const { prepared } = ready;
  const { answers, owner, built } = prepared;
  const venues = enabledVenues(built.config, coreVenues(context.host.http, built.config.venues));
  const draft = venues.ok ? agentDraftOf(context, built.config, venues.value) : venues;
  const timeZone = built.config.owner.timezone;
  const agent = draft.ok
    ? await ensureFirstAgent(context, stores, { draft: draft.value, timeZone })
    : draft;
  if (!agent.ok) {
    return agent;
  }
  const agentKey = await takeAgentKey(context, answers.unlock, ready.installId);
  if (!agentKey.ok) {
    return agentKey;
  }
  await storeTyped(context, answers);
  const wallets = owner.owned.map((item) => ({ wallet: item.wallet.id, policy: item.policy.id }));
  const moved = await moveSigners(context, {
    appId: answers.app.appId,
    appSecret: answers.app.secret.value,
    authorize: owner.authorize,
    agentKey: agentKey.value.publicKey,
    wallets,
  });
  if (!moved.ok) {
    return moved;
  }
  const done = { prepared, agent: agent.value, agentKey: agentKey.value, moved: moved.value };
  const recorded = await record(context, stores, done);
  return recorded.ok ? ok({ agentKey: agentKey.value, moved: moved.value }) : recorded;
}

/**
 * Rebuilds an install on a folder that holds none, for a machine lost with no backup (decision
 * 0142). It warns first that history, settings, labels, saved addresses and the bot's pairing
 * start fresh, takes the Privy app and the owner key, finds the wallets the key owns, reads the
 * rescue address from their ceilings or asks for one they list, and goes on only once the person
 * types how many wallets it found. Then, as init does, it takes the bot and the limits and builds
 * the config, makes the first agent and this machine's agent key, moves every wallet's signer to
 * the key in a change the owner key signs, records the wallets with their ceilings, issues the
 * bot's pairing link and writes the config last. Nothing changes on Privy before the count is
 * typed.
 */
export async function runRebuild(
  context: InitContext,
  stores: InitStores,
  installId: Id<"ins">,
): Promise<InitStep<RebuildOutcome>> {
  const prepared = await prepare(context);
  if (!prepared.ok) {
    return prepared;
  }
  const made = await make(context, stores, { prepared: prepared.value, installId });
  if (!made.ok) {
    return made;
  }
  const { answers, owner, built } = prepared.value;
  const pairing = await issuePairing(context, stores, answers.bot.account.username);
  return ok({
    addresses: owner.owned.map((item) => item.wallet.address),
    rescue: answers.rescue.address,
    moved: made.value.moved,
    unlockMode: answers.unlock.mode,
    isAgentKeyNew: made.value.agentKey.isNew,
    pairingLink: pairing.link,
    pairingExpiresAtMs: pairing.expiresAtMs,
    botUsername: answers.bot.account.username,
    configFile: await writeConfig(context, built.text),
  });
}
