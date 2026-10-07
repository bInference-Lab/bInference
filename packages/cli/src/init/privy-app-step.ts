import { ok, type Result, retry, type Secret } from "@binference/core";
import { checkPrivyApp } from "@binference/custody-privy";
import { type InitContext, type InitStep, refused } from "./init-context.js";
import { type TakenSecret, takeSecret } from "./take-secret.js";

/** The owner's Privy app, checked: its id and its secret. */
export interface PrivyApp {
  readonly appId: string;
  readonly secret: TakenSecret;
}

// A Privy app id is a short token of letters and digits; anything else never reaches a header.
const appIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
// How often a person may type the app's details before init stops.
const maxTries = 3;
// Privy's guide asks for an exponential backoff on 429; a read that got no answer is tried again too.
const backoff = { attempts: 3, baseDelayMs: 1_000, maxDelayMs: 4_000, budgetMs: 20_000 };

async function appIdOf(context: InitContext): Promise<InitStep<string>> {
  const given = context.flags.privyAppId;
  if (given !== undefined) {
    return appIdPattern.test(given)
      ? ok(given)
      : refused("init.bad_app_id", "refused.badAppId", { flag: "--privy-app-id" });
  }
  if (!context.isInteractive) {
    return refused("init.needs_flag", "refused.needsFlag", { flag: "--privy-app-id" });
  }
  const typed = await context.prompter.ask({
    id: "privyAppId",
    message: context.words("privy.appId"),
    check: (answer) =>
      appIdPattern.test(answer.trim()) ? undefined : context.words("privy.badAppId"),
  });
  return ok(typed.trim());
}

async function check(
  context: InitContext,
  appId: string,
  appSecret: Secret,
): Promise<Result<void, "rejected">> {
  const { host, signal } = context;
  return retry(
    async (attempt) =>
      checkPrivyApp(
        { http: host.http, clock: host.clock, appId, appSecret },
        { signal: attempt.signal },
      ),
    { ...backoff, signal, clock: host.clock, random: host.random },
  );
}

async function tryApp(context: InitContext): Promise<InitStep<PrivyApp | undefined>> {
  const appId = await appIdOf(context);
  if (!appId.ok) {
    return appId;
  }
  const secret = await takeSecret(context, {
    flag: "--privy-app-secret",
    flagText: context.flags.privyAppSecret,
    path: "custody.privy.appSecret",
    question: { id: "privyAppSecret", message: context.words("privy.appSecret") },
  });
  if (!secret.ok) {
    return secret;
  }
  const checked = await check(context, appId.value, secret.value.value);
  return ok(checked.ok ? { appId: appId.value, secret: secret.value } : undefined);
}

/**
 * The Privy app step (keys spec, section 2, step 1): shows how to make the app, takes its id and
 * secret, and checks both with one read. A person may type them again after Privy refuses them;
 * from flags, a refusal stops init.
 */
export async function takePrivyApp(context: InitContext): Promise<InitStep<PrivyApp>> {
  context.prompter.note(context.words("privy.steps"), context.words("privy.title"));
  return takePrivyAppAgain(context, 1);
}

async function takePrivyAppAgain(context: InitContext, tries: number): Promise<InitStep<PrivyApp>> {
  const app = await tryApp(context);
  if (!app.ok) {
    return app;
  }
  if (app.value !== undefined) {
    context.prompter.say(context.words("privy.checked"));
    return ok(app.value);
  }
  const fromFlags = context.flags.privyAppSecret !== undefined || !context.isInteractive;
  if (fromFlags || tries >= maxTries) {
    return refused("init.privy_rejected", "refused.privyRejected");
  }
  context.prompter.say(context.words("privy.rejected"));
  return takePrivyAppAgain(context, tries + 1);
}
