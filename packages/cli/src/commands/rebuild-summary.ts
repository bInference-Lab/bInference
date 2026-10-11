import type { Formatter } from "@binference/i18n";
import type { RebuildOutcome } from "../attach/run-rebuild.js";
import type { InitContext } from "../init/init-context.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { setupDoneLines } from "./setup-done-lines.js";

/**
 * The end of a rebuild (decision 0142): the wallets this machine now signs for, its signer ID and
 * the rescue address, what starts fresh, the signers removed, the agent key's place, the bot's
 * pairing link, shown once, and the config file. Scripts get the same as JSON, the link once.
 */
export function rebuildSummary(
  context: InitContext,
  report: { readonly output: CliOutput; readonly formatter: Formatter },
  outcome: RebuildOutcome,
): ExitCode {
  const { words } = context;
  const { moved } = outcome;
  const values = {
    count: outcome.addresses.length,
    addresses: outcome.addresses.join(", "),
    signer: moved.signer,
    rescue: outcome.rescue,
  };
  const lines = [
    words("rebuild.done.wallets", values),
    words("rebuild.done.fresh"),
    ...(moved.removed.length === 0
      ? []
      : [words("attach.done.removed", { signers: moved.removed.join(", ") })]),
    ...setupDoneLines(words, report.formatter, outcome),
  ];
  context.prompter.note(lines.join("\n\n"), words("rebuild.done.title"));
  context.prompter.outro(words("done.next"));
  report.output.json({
    state: "rebuilt",
    wallets: outcome.addresses,
    signer: moved.signer,
    removedSigners: moved.removed,
    rescue: outcome.rescue,
    unlockMode: outcome.unlockMode,
    agentKey: outcome.isAgentKeyNew ? "made" : "kept",
    pairing: { link: outcome.pairingLink.reveal(), expiresAtMs: outcome.pairingExpiresAtMs },
    configFile: outcome.configFile,
  });
  return 0;
}
