import { type Logger, ok, type Result, type Secret } from "@binference/core";
import {
  type BotAccount,
  type BotTokenProblem,
  checkBotToken,
  createBotThrottlers,
} from "@binference/telegram";
import { Api } from "grammy";
import { type InitContext, type InitStep, refused } from "./init-context.js";
import { type TakenSecret, takeSecret } from "./take-secret.js";

/** The owner's bot: its token and the bot `getMe` names. */
export interface OwnerBot {
  readonly token: TakenSecret;
  readonly account: BotAccount;
}

const maxTries = 3;

// Init writes no log; a flood wait the throttler logs has nowhere to go.
const quiet: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
};

async function check(
  context: InitContext,
  token: Secret,
): Promise<Result<BotAccount, BotTokenProblem>> {
  const { host } = context;
  const fetch = host.botApiFetch;
  const api = new Api(token.reveal(), fetch === undefined ? {} : { fetch });
  createBotThrottlers({ clock: host.clock, logger: quiet }).install(api);
  return checkBotToken(api, { signal: context.signal });
}

async function tryToken(
  context: InitContext,
): Promise<InitStep<Result<OwnerBot, BotTokenProblem>>> {
  const token = await takeSecret(context, {
    flag: "--bot-token",
    flagText: context.flags.botToken,
    path: "telegram.botToken",
    question: { id: "botToken", message: context.words("bot.token") },
  });
  if (!token.ok) {
    return token;
  }
  const account = await check(context, token.value.value);
  return ok(account.ok ? ok({ token: token.value, account: account.value }) : account);
}

/**
 * The bot step: takes the owner's BotFather token and checks it with `getMe`, which also names
 * the bot for the pairing link. A person may type it again after a refusal; from a flag, a
 * refusal stops init.
 */
export async function takeOwnerBot(context: InitContext): Promise<InitStep<OwnerBot>> {
  context.prompter.note(context.words("bot.steps"), context.words("bot.title"));
  return takeOwnerBotAgain(context, 1);
}

async function takeOwnerBotAgain(context: InitContext, tries: number): Promise<InitStep<OwnerBot>> {
  const bot = await tryToken(context);
  if (!bot.ok) {
    return bot;
  }
  if (bot.value.ok) {
    const { username } = bot.value.value.account;
    context.prompter.say(context.words("bot.checked", { username }));
    return ok(bot.value.value);
  }
  const problem = bot.value.error;
  const fromFlags = context.flags.botToken !== undefined || !context.isInteractive;
  if (fromFlags || tries >= maxTries) {
    return refused(`init.bot_${problem}`, `refused.bot.${problem}`);
  }
  context.prompter.say(context.words(`bot.${problem}`));
  return takeOwnerBotAgain(context, tries + 1);
}
