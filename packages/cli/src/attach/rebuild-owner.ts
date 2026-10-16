import { createSecret, ok, type Secret } from "@binference/core";
import {
  createPrivyApi,
  findOwnedWallets,
  type OwnedWallet,
  type OwnerAuthorize,
} from "@binference/custody-privy";
import { parseOwnerKeyCode } from "@binference/signer";
import { ownerAuthorize } from "../compose/owner-authorize.js";
import { deriveSealingKey } from "../hpke/sealing-key.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import type { OwnerKey } from "../init/owner-key-step.js";
import type { PrivyApp } from "../init/privy-app-step.js";

/** The owner key a rebuild runs with, and the wallets it owns on Privy. */
export interface RebuildOwner {
  readonly ownerKey: OwnerKey;
  readonly authorize: OwnerAuthorize;
  readonly owned: readonly OwnedWallet[];
}

// How many owner key codes a person may type before the rebuild stops.
const maxTries = 3;

// The wallets the code's key owns, or none for a code that is no owner key code.
async function ownedBy(
  context: InitContext,
  app: PrivyApp,
  code: Secret,
): Promise<RebuildOwner | undefined> {
  const pair = parseOwnerKeyCode(code);
  if (!pair.ok) {
    return undefined;
  }
  const { host, signal } = context;
  const api = createPrivyApi({
    http: host.http,
    clock: host.clock,
    appId: app.appId,
    appSecret: app.secret.value,
  });
  const { publicKey } = pair.value;
  const owned = await findOwnedWallets(api, { ownerKey: publicKey }, { signal });
  const holder = { ownerKeyPublic: async () => Promise.resolve(publicKey) };
  const authorize = await ownerAuthorize(holder, code, signal);
  if (owned.length === 0 || !authorize.ok) {
    return undefined;
  }
  const sealing = deriveSealingKey(pair.value.privateKey);
  const ownerKey = { publicKey, sealKeyPublic: sealing.publicKey };
  return { ownerKey, authorize: authorize.value, owned };
}

async function askOwner(
  context: InitContext,
  app: PrivyApp,
  tries: number,
): Promise<InitStep<RebuildOwner>> {
  const typed = await context.prompter.ask({
    id: "ownerKey",
    message: context.words("attach.ownerKey"),
    isSecret: true,
  });
  const owner = await ownedBy(context, app, createSecret(typed.trim()));
  if (owner !== undefined) {
    return ok(owner);
  }
  if (tries >= maxTries) {
    return refused("init.rebuild_no_wallets", "refused.rebuildNoWallets");
  }
  context.prompter.say(context.words("rebuild.noWallets"));
  return askOwner(context, app, tries + 1);
}

/**
 * The owner key step of a rebuild (decision 0142): asks for the owner key code with hidden input,
 * up to 3 tries, and finds every wallet its key owns on Privy, launch wallets too. A code
 * that is none, or one whose key owns no wallet of the app, asks again. No flag takes the code.
 */
export async function takeRebuildOwner(
  context: InitContext,
  app: PrivyApp,
): Promise<InitStep<RebuildOwner>> {
  return context.isInteractive
    ? askOwner(context, app, 1)
    : refused("init.owner_key_needs_terminal", "refused.attachOwnerKeyTerminal");
}
