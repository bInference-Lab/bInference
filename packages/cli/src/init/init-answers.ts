import { ok } from "@binference/core";
import type { UnlockMode } from "../config/schema/engine.schema.js";
import type { CommandSource } from "../config/schema/secret-source.schema.js";
import { unlockCommandOf } from "./agent-key-step.js";
import { type OwnerBot, takeOwnerBot } from "./bot-token-step.js";
import type { InitContext, InitStep } from "./init-context.js";
import { makeOwnerKey, type OwnerKey } from "./owner-key-step.js";
import { type PrivyApp, takePrivyApp } from "./privy-app-step.js";
import { type RescueAddress, takeRescueAddress } from "./rescue-step.js";
import { type SecretPlace, secretPlaceOf } from "./secret-places.js";

/** Where the agent key is read at start: the unlock mode, and its program in `command` mode. */
interface Unlock {
  readonly mode: UnlockMode;
  readonly command?: CommandSource;
}

/** The answers init takes, and checks, before it stores or makes anything. */
export interface Answers {
  readonly unlock: Unlock;
  /** Where the secrets a person types are kept. */
  readonly place: SecretPlace;
  readonly app: PrivyApp;
  readonly ownerKey: OwnerKey;
  readonly rescue: RescueAddress;
  readonly bot: OwnerBot;
}

/**
 * The unlock mode (keys spec, section 3): the one `--unlock` names, else the keychain with a
 * desktop session and an owner-only file without one, as headless Linux and Docker have.
 */
function unlockOf(context: InitContext): InitStep<Unlock> {
  const mode = context.flags.unlock ?? (context.platform.hasDesktopSession ? "keychain" : "file");
  const command = unlockCommandOf(context, mode);
  if (!command.ok) {
    return command;
  }
  return ok(command.value === undefined ? { mode } : { mode, command: command.value });
}

/**
 * Takes init's answers in the order of the onboarding (ARCHITECTURE section 27): the unlock
 * mode, the Privy app, the owner key with its check-back, the rescue address and the bot.
 */
export async function takeAnswers(context: InitContext): Promise<InitStep<Answers>> {
  const unlock = unlockOf(context);
  if (!unlock.ok) {
    return unlock;
  }
  const app = await takePrivyApp(context);
  if (!app.ok) {
    return app;
  }
  const ownerKey = await makeOwnerKey(context);
  if (!ownerKey.ok) {
    return ownerKey;
  }
  const rescue = await takeRescueAddress(context);
  if (!rescue.ok) {
    return rescue;
  }
  const bot = await takeOwnerBot(context);
  if (!bot.ok) {
    return bot;
  }
  return ok({
    unlock: unlock.value,
    place: secretPlaceOf(unlock.value.mode, context.platform),
    app: app.value,
    ownerKey: ownerKey.value,
    rescue: rescue.value,
    bot: bot.value,
  });
}
