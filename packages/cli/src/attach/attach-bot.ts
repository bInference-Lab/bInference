import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { InitContext } from "../init/init-context.js";
import { heldSecret } from "./attach-secret.js";

/**
 * The bot step of `binference init --attach`: the bot token from the source config.json5 names,
 * or typed by a person, hidden, and kept where that source reads it, as a moved machine's keychain
 * or `keys/` starts without it. Answers whether this machine reads the token; without it the
 * engine starts without the bot, which attach's summary says. Telegram checks the token when the
 * engine starts.
 */
export async function takeAttachBot(
  context: InitContext,
  config: Pick<BinferenceConfig, "telegram">,
): Promise<boolean> {
  const question = { id: "botToken", message: context.words("attach.botToken") };
  const source = config.telegram.botToken;
  const token = await heldSecret(context, { path: "telegram.botToken", source, question });
  return token !== undefined;
}
