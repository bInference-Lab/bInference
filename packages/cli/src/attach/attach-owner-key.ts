import { createSecret, ok } from "@binference/core";
import type { OwnerAuthorize } from "@binference/custody-privy";
import { ownerAuthorize } from "../compose/owner-authorize.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";

// How many owner key codes a person may type before attach stops.
const maxTries = 3;

async function askOwnerKey(
  context: InitContext,
  ownerKeyPublic: string,
  tries: number,
): Promise<InitStep<OwnerAuthorize>> {
  const typed = await context.prompter.ask({
    id: "ownerKey",
    message: context.words("attach.ownerKey"),
    isSecret: true,
  });
  const holder = { ownerKeyPublic: async () => Promise.resolve(ownerKeyPublic) };
  const authorize = await ownerAuthorize(holder, createSecret(typed.trim()), context.signal);
  if (authorize.ok) {
    return ok(authorize.value);
  }
  if (tries >= maxTries) {
    return refused("wallet.bad_owner_key", "refused.attachOwnerKey");
  }
  context.prompter.say(context.words("attach.ownerKeyWrong"));
  return askOwnerKey(context, ownerKeyPublic, tries + 1);
}

/**
 * The owner key step of `binference init --attach`: asks a person for the owner key code with
 * hidden input, up to 3 tries, and answers what signs Privy requests with it once its public half
 * is the install's owner key; a wrong code never reaches Privy. No flag takes the code, so attach
 * without a person at the terminal stops here. The key is kept nowhere and lives only as long as
 * this run.
 */
export async function takeOwnerKey(
  context: InitContext,
  ownerKeyPublic: string,
): Promise<InitStep<OwnerAuthorize>> {
  return context.isInteractive
    ? askOwnerKey(context, ownerKeyPublic, 1)
    : refused("init.owner_key_needs_terminal", "refused.attachOwnerKeyTerminal");
}
