import type { MessageValues } from "@binference/i18n";
import { makeOwnerKey } from "../init/owner-key-step.js";
import type { ChosenCommand } from "../program/chosen-command.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";

/**
 * `binference owner-key create`: makes an owner key on a machine with a terminal, for an install
 * set up where nobody sees one (decision 0148). It shows the key's code once, in the terminal
 * only, with the same check-back as `init`, then prints the public half for
 * `binference init --owner-key-public`. It reads and writes no state folder and keeps nothing.
 * With `--yes`, `--json` or nobody at the terminal it makes no key.
 */
export async function runOwnerKeyCreate(
  run: CommandRun,
  chosen: Extract<ChosenCommand, { readonly name: "ownerKeyCreate" }>,
): Promise<ExitCode> {
  const { host, output, formatter } = run;
  const { prompter } = host;
  if (prompter === undefined || chosen.options.yes || chosen.options.json) {
    output.fail({ code: "init.owner_key_needs_terminal", key: "ownerKey.createNeedsTerminal" });
    return 1;
  }
  const made = await makeOwnerKey({
    prompter,
    isInteractive: true,
    words: (key: string, values?: MessageValues) => formatter.message(`init.${key}`, values),
  });
  if (!made.ok) {
    output.fail({ code: made.refusal.code, key: "ownerKey.createUnconfirmed" });
    return 1;
  }
  output.say("ownerKey.created", { key: made.value.publicKey });
  return 0;
}
