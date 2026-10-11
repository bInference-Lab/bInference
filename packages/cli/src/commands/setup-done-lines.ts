import type { Formatter } from "@binference/i18n";
import type { InitContext } from "../init/init-context.js";
import type { InitOutcome } from "../init/run-init.js";

/** What the end of a set-up says besides its wallets: the agent key, the bot and the config. */
export type SetupDone = Pick<
  InitOutcome,
  | "isAgentKeyNew"
  | "unlockMode"
  | "botUsername"
  | "pairingLink"
  | "pairingExpiresAtMs"
  | "configFile"
>;

/**
 * The closing lines of a set-up on this machine, as init and a rebuild show them: where the agent
 * key is kept, the bot's pairing link, shown once, with when it expires, and the config file.
 */
export function setupDoneLines(
  words: InitContext["words"],
  formatter: Formatter,
  done: SetupDone,
): readonly string[] {
  return [
    words(done.isAgentKeyNew ? "done.unlockMade" : "done.unlockKept", { mode: done.unlockMode }),
    words("done.pairing", {
      bot: done.botUsername,
      link: done.pairingLink.reveal(),
      expires: formatter.dateTime(done.pairingExpiresAtMs),
    }),
    words("done.config", { file: done.configFile }),
  ];
}
