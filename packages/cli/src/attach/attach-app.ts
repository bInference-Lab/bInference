import { basename, dirname, resolve } from "node:path";
import { BinferenceError, ok, type Secret, type SecretStore } from "@binference/core";
import type { CustodyRecord } from "@binference/engine/install";
import { createFileSecretStore } from "@binference/platform";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import { checkAppOnPrivy } from "../init/privy-app-step.js";
import { takeSecret } from "../init/take-secret.js";

/** The install's Privy app as this machine reaches it: its id and its secret, checked. */
export interface AttachApp {
  readonly appId: string;
  readonly appSecret: Secret;
}

const secretPath = "custody.privy.appSecret";

// Where a typed app secret is kept so the source config.json5 names finds it: a keychain entry,
// or a file in this folder's `keys/`. Any other source is the owner's to fill.
function storeOf(
  context: InitContext,
  source: SecretSource,
): { readonly store: SecretStore; readonly name: string } | undefined {
  const { keychain, stateFolder, permissions } = context.platform;
  if ("fromKeychain" in source) {
    return { store: keychain, name: source.fromKeychain };
  }
  if ("fromFile" in source && dirname(resolve(source.fromFile)) === resolve(stateFolder.keys)) {
    const store = createFileSecretStore({ folder: stateFolder.keys, permissions });
    return { store, name: basename(source.fromFile) };
  }
  return undefined;
}

async function readSecret(context: InitContext, source: SecretSource): Promise<Secret | undefined> {
  try {
    return await context.secrets.read(secretPath, source, context.signal);
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "config.secret_unavailable") {
      return undefined;
    }
    throw error;
  }
}

// The secret where config.json5 names it, or typed by the person and kept there.
async function secretOf(context: InitContext, source: SecretSource): Promise<InitStep<Secret>> {
  const held = await readSecret(context, source);
  if (held !== undefined) {
    return ok(held);
  }
  const place = storeOf(context, source);
  if (place === undefined || !context.isInteractive) {
    return refused("init.attach_app_secret", "refused.attachAppSecret");
  }
  const question = { id: "privyAppSecret", message: context.words("attach.appSecret") };
  const typed = await takeSecret(context, {
    flag: "--privy-app-secret",
    flagText: undefined,
    path: secretPath,
    question,
  });
  if (!typed.ok) {
    return typed;
  }
  await place.store.write(place.name, typed.value.value, context.signal);
  return ok(typed.value.value);
}

/**
 * The Privy app step of `binference init --attach` (keys spec, section 6): the app id config.json5
 * names, which must be the app that holds the install's wallets, and its secret from the source
 * config.json5 names. A machine that does not hold the secret there yet asks a person for it,
 * hidden, and keeps it where that source reads it: a keychain entry or a file in `keys/`. Privy
 * then checks both with one read.
 */
export async function takeAttachApp(
  context: InitContext,
  config: Pick<BinferenceConfig, "custody">,
  custody: CustodyRecord,
): Promise<InitStep<AttachApp>> {
  const { appId, appSecret: source } = config.custody.privy;
  if (appId !== custody.appId) {
    return refused("init.attach_other_app", "refused.attachOtherApp", { appId: custody.appId });
  }
  if (source === undefined) {
    return refused("init.attach_no_app_secret", "refused.attachNoAppSecret");
  }
  const appSecret = await secretOf(context, source);
  if (!appSecret.ok) {
    return appSecret;
  }
  const checked = await checkAppOnPrivy(context, appId, appSecret.value);
  return checked.ok
    ? ok({ appId, appSecret: appSecret.value })
    : refused("init.privy_rejected", "refused.privyRejected");
}
