import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withEngine } from "./connect-engine.js";

/**
 * `binference telegram pair`: a new single-use pairing link for the owner's bot, valid 10
 * minutes, through `telegram/pair` over IPC (decision 0139). The link is printed once and never
 * logged; whoever opens it first becomes the owner, and the current owner stays until then and is
 * told in their chat. With `--json` it prints `{ link, expiresAt }`.
 */
export async function runTelegramPair(run: CommandRun): Promise<ExitCode> {
  const { host, output, formatter } = run;
  return withEngine(host, output, async (client, signal) => {
    const { link, expiresAt } = await client.call("telegram/pair", {}, { signal });
    output.json({ link, expiresAt });
    output.say("telegramPair.link", { link, expires: formatter.dateTime(expiresAt) });
    return 0;
  });
}
