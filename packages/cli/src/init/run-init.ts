import { createIdSource, type Id, ok, type Secret } from "@binference/core";
import { buildCeiling, type Ceiling, type CeilingRequest } from "@binference/custody-privy";
import type { AgentDraft } from "@binference/engine";
import { ensurePrivateFolder, writePrivateFile } from "@binference/platform";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import type { UnlockMode } from "../config/schema/engine.schema.js";
import { systemDefaults } from "../program/system-defaults.js";
import { type AgentKey, takeAgentKey } from "./agent-key-step.js";
import { ceilingRequestOf, coreVenues, enabledVenues } from "./ceiling-request.js";
import { firstAgentDraft } from "./first-agent.js";
import { type Answers, takeAnswers } from "./init-answers.js";
import { type InitConfig, initConfig } from "./init-config.js";
import { type InitContext, type InitStep, refused } from "./init-context.js";
import { ensureFirstAgent, type InitStores, issuePairing, recordInstall } from "./install-step.js";
import { takeLimits } from "./limits-step.js";
import { appSecretEntry, botTokenEntry } from "./secret-places.js";
import { type FirstWallet, makeFirstWallet } from "./wallet-step.js";

/** What a finished init set up, for its summary. */
export interface InitOutcome {
  readonly walletAddress: string;
  readonly privyWalletId: string;
  readonly unlockMode: UnlockMode;
  /** The owner key's code, shown once; a run with no person gives it in its JSON answer. */
  readonly ownerKeyCode: Secret;
  readonly isAgentKeyNew: boolean;
  readonly pairingLink: Secret;
  readonly pairingExpiresAtMs: number;
  readonly botUsername: string;
  readonly configFile: string;
}

async function configOf(context: InitContext, answers: Answers): Promise<InitStep<InitConfig>> {
  const { app, bot, place, unlock } = answers;
  const settings = {
    unlockMode: unlock.mode,
    ...(unlock.command === undefined ? {} : { unlockCommand: unlock.command }),
    appId: app.appId,
    appSecret: app.secret.source ?? place.sourceOf(appSecretEntry),
    ownerKeyPublic: answers.ownerKey.publicKey,
    botToken: bot.token.source ?? place.sourceOf(botTokenEntry),
    limits: await takeLimits(context),
  };
  return initConfig(context, settings, systemDefaults(context.host.env, context.platform));
}

// Stores each secret a person typed where the unlock mode keeps it; a flag's source stays put.
async function storeTyped(context: InitContext, answers: Answers): Promise<void> {
  const typed = [
    [appSecretEntry, answers.app.secret],
    [botTokenEntry, answers.bot.token],
  ] as const;
  const writes = typed.filter(([, secret]) => secret.source === undefined);
  await Promise.all(
    writes.map(async ([entry, secret]) =>
      answers.place.store.write(entry, secret.value, context.signal),
    ),
  );
}

async function writeConfig(context: InitContext, text: string): Promise<string> {
  const { stateFolder, permissions } = context.platform;
  const files = { permissions, signal: context.signal };
  await ensurePrivateFolder(stateFolder.root, files);
  await writePrivateFile(stateFolder.configFile, text, files);
  return stateFolder.configFile;
}

/** Everything init checked before it stores or makes anything. */
interface Prepared {
  readonly answers: Answers;
  readonly built: InitConfig;
  /** The first wallet's ceiling, and its cap per contract call on the first chain. */
  readonly ceiling: Ceiling;
  readonly perTxNativeBase: bigint;
  /** The first agent, made when the install has none. */
  readonly agentDraft: AgentDraft;
}

/** What init made: the first wallet and the agent key it is signed for. */
interface Made {
  readonly first: FirstWallet;
  readonly agentKey: AgentKey;
}

function ceilingOf(request: CeilingRequest): InitStep<Ceiling> {
  const ceiling = buildCeiling(request);
  return ceiling.ok
    ? ceiling
    : refused("init.bad_ceiling", "refused.badCeiling", { problem: ceiling.error });
}

async function prepare(context: InitContext): Promise<InitStep<Prepared>> {
  const answers = await takeAnswers(context);
  if (!answers.ok) {
    return answers;
  }
  const built = await configOf(context, answers.value);
  if (!built.ok) {
    return built;
  }
  const { config } = built.value;
  const registry = selfHostedChains();
  const venues = enabledVenues(config, coreVenues(context.host.http, config.venues.kyberClientId));
  if (!venues.ok) {
    return venues;
  }
  const rescue = answers.value.rescue.address;
  const request = ceilingRequestOf(registry, config, { venues: venues.value, rescue });
  if (!request.ok) {
    return request;
  }
  const ceiling = ceilingOf(request.value);
  if (!ceiling.ok) {
    return ceiling;
  }
  const { host } = context;
  const agentDraft = firstAgentDraft(config, registry, {
    id: createIdSource({ clock: host.clock, random: host.random }).next("agt"),
    atMs: host.clock.now(),
    venues: venues.value.map((venue) => venue.id),
  });
  return agentDraft.ok
    ? ok({
        answers: answers.value,
        built: built.value,
        ceiling: ceiling.value,
        perTxNativeBase: request.value.chains[0]?.perTxNativeCapBase ?? 0n,
        agentDraft: agentDraft.value,
      })
    : agentDraft;
}

async function makeWallet(
  context: InitContext,
  prepared: Prepared,
  installId: Id<"ins">,
): Promise<InitStep<Made>> {
  const { app, ownerKey, unlock } = prepared.answers;
  const agentKey = await takeAgentKey(context, unlock, installId);
  if (!agentKey.ok) {
    return agentKey;
  }
  await storeTyped(context, prepared.answers);
  const first = await makeFirstWallet(context, {
    appId: app.appId,
    appSecret: app.secret.value,
    ownerKey: ownerKey.publicKey,
    agentKey: agentKey.value.publicKey,
    ceiling: prepared.ceiling,
  });
  return first.ok ? ok({ first: first.value, agentKey: agentKey.value }) : first;
}

async function record(
  context: InitContext,
  stores: InitStores,
  done: { readonly prepared: Prepared; readonly made: Made; readonly agent: Id<"agt"> },
): Promise<InitStep<InitOutcome>> {
  const { prepared, made } = done;
  const { app, bot, ownerKey, rescue, unlock } = prepared.answers;
  const recorded = await recordInstall(context, stores, {
    agent: done.agent,
    appId: app.appId,
    ownerKey: ownerKey.publicKey,
    agentKey: made.agentKey.publicKey,
    rescue,
    first: made.first,
    perTxNativeBase: prepared.perTxNativeBase,
  });
  if (!recorded.ok) {
    return recorded;
  }
  const pairing = await issuePairing(context, stores, bot.account.username);
  return ok({
    walletAddress: made.first.wallet.address,
    privyWalletId: made.first.wallet.id,
    unlockMode: unlock.mode,
    ownerKeyCode: ownerKey.code,
    isAgentKeyNew: made.agentKey.isNew,
    pairingLink: pairing.link,
    pairingExpiresAtMs: pairing.expiresAtMs,
    botUsername: bot.account.username,
    configFile: await writeConfig(context, prepared.built.text),
  });
}

/**
 * Runs `binference init` once its database is open (keys spec, section 2): every question and
 * check first, then the config built and loaded, then this machine's agent key and the typed
 * secrets stored, the first wallet made on Privy and read back, the setup recorded, the bot's
 * pairing link issued, and the config file written last, once, owner-only. A refusal before the
 * wallet leaves nothing on Privy.
 */
export async function runInit(
  context: InitContext,
  stores: InitStores,
  installId: Id<"ins">,
): Promise<InitStep<InitOutcome>> {
  const prepared = await prepare(context);
  if (!prepared.ok) {
    return prepared;
  }
  const agent = await ensureFirstAgent(context, stores, prepared.value.agentDraft);
  if (!agent.ok) {
    return agent;
  }
  const made = await makeWallet(context, prepared.value, installId);
  return made.ok
    ? record(context, stores, { prepared: prepared.value, made: made.value, agent: agent.value })
    : made;
}
