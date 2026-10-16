import type { JsonValue } from "@binference/core";
import type { Formatter } from "@binference/i18n";
import type { InitContext } from "../init/init-context.js";
import type { InitOutcome } from "../init/run-init.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { setupDoneLines } from "./setup-done-lines.js";

/** What the init command reports with: the command's output and the owner's formatter. */
export interface Report {
  readonly output: CliOutput;
  readonly formatter: Formatter;
  readonly isJson: boolean;
}

/**
 * The note that ends a new set-up: the wallet, paper mode and how to go live, where the agent key
 * is kept, the bot's pairing link and the config file, then the next step; with `--json` the same
 * as one answer.
 */
export function setupSummary(context: InitContext, report: Report, outcome: InitOutcome): ExitCode {
  const { words } = context;
  const lines = [
    words("done.wallet", { address: outcome.walletAddress }),
    words("done.paper"),
    words("done.goLive", {
      disclaimer: outcome.disclaimer === "not_accepted" ? "not" : "accepted",
    }),
    ...setupDoneLines(words, report.formatter, outcome),
  ];
  context.prompter.note(lines.join("\n\n"), words("done.title"));
  context.prompter.outro(words("done.next"));
  const answer: JsonValue = {
    state: "set_up",
    wallet: { address: outcome.walletAddress, privyWalletId: outcome.privyWalletId },
    unlockMode: outcome.unlockMode,
    agentKey: outcome.isAgentKeyNew ? "made" : "kept",
    pairing: { link: outcome.pairingLink.reveal(), expiresAtMs: outcome.pairingExpiresAtMs },
    configFile: outcome.configFile,
    disclaimer: outcome.disclaimer,
    telemetry: outcome.telemetry,
  };
  report.output.json(answer);
  return 0;
}
