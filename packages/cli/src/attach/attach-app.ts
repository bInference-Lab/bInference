import { ok, type Secret } from "@binference/core";
import type { CustodyRecord } from "@binference/engine/install";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";
import { checkAppOnPrivy } from "../init/privy-app-step.js";
import { heldSecret } from "./attach-secret.js";

/** The install's Privy app as this machine reaches it: its id and its secret, checked. */
export interface AttachApp {
  readonly appId: string;
  readonly appSecret: Secret;
}

const secretPath = "custody.privy.appSecret";

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
  const question = { id: "privyAppSecret", message: context.words("attach.appSecret") };
  const appSecret = await heldSecret(context, { path: secretPath, source, question });
  if (appSecret === undefined) {
    return refused("init.attach_app_secret", "refused.attachAppSecret");
  }
  const checked = await checkAppOnPrivy(context, appId, appSecret);
  return checked.ok
    ? ok({ appId, appSecret })
    : refused("init.privy_rejected", "refused.privyRejected");
}
