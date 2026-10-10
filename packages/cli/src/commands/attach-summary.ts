import type { AttachOutcome } from "../attach/run-attach.js";
import type { InitContext } from "../init/init-context.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";

/**
 * The end of `binference init --attach`: which wallets this machine now signs for and its signer
 * ID, the signers removed, what the old machine does from now on, and the next steps: stop the
 * old machine, since two machines cannot poll one Telegram bot, then start this one and pair the
 * bot with it. Scripts get the same as JSON.
 */
export function attachSummary(
  context: InitContext,
  output: CliOutput,
  outcome: AttachOutcome,
): ExitCode {
  const { words } = context;
  const removed = outcome.removed.join(", ");
  const lines = [
    words("attach.done.wallets", { count: outcome.wallets, signer: outcome.signer }),
    words(outcome.isAgentKeyNew ? "done.unlockMade" : "done.unlockKept", {
      mode: outcome.unlockMode,
    }),
    ...(outcome.removed.length === 0 ? [] : [words("attach.done.removed", { signers: removed })]),
    words("attach.done.next"),
  ];
  context.prompter.note(lines.join("\n\n"), words("attach.done.title"));
  output.json({
    state: "attached",
    wallets: outcome.wallets,
    signer: outcome.signer,
    removedSigners: outcome.removed,
    unlockMode: outcome.unlockMode,
    agentKey: outcome.isAgentKeyNew ? "made" : "kept",
  });
  return 0;
}
