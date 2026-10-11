import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withEngine } from "./connect-engine.js";

/**
 * `binference console`: a new single-use link that pairs a browser with the console, valid 10
 * minutes, through `device/pair` over IPC (decision 0155). The link is printed once and never
 * logged; the browser that opens it first keeps a device key the engine paired. With `--json` it
 * prints `{ link, expiresAt }`.
 */
export async function runConsole(run: CommandRun): Promise<ExitCode> {
  const { host, output, formatter } = run;
  return withEngine(host, output, async (client, signal) => {
    const { link, expiresAt } = await client.call("device/pair", {}, { signal });
    output.json({ link, expiresAt });
    output.say("console.link", { link, expires: formatter.dateTime(expiresAt) });
    return 0;
  });
}
