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

function modelLine(context: InitContext, outcome: InitOutcome): string {
  const { model } = outcome;
  if (model === undefined) {
    return context.words("done.noModel");
  }
  const provider = context.words(`model.provider.${model.preset}`);
  return context.words("done.model", { model: model.model, provider, place: model.keyPlace });
}

/**
 * The note that ends a new set-up: the wallet, the model, paper mode and how to go live, where
 * the agent key is kept, the bot's pairing link and the config file, then the next step; with
 * `--json` the same as one answer. The key of the model is never in it.
 */
export function setupSummary(context: InitContext, report: Report, outcome: InitOutcome): ExitCode {
  const { words } = context;
  const lines = [
    words("done.wallet", { address: outcome.walletAddress }),
    modelLine(context, outcome),
    words("done.paper"),
    words("done.goLive", {
      disclaimer: outcome.disclaimer === "not_accepted" ? "not" : "accepted",
    }),
    ...setupDoneLines(words, report.formatter, outcome),
  ];
  context.prompter.note(lines.join("\n\n"), words("done.title"));
  context.prompter.outro(words("done.next"));
  const { model } = outcome;
  const answer: JsonValue = {
    state: "set_up",
    wallet: { address: outcome.walletAddress, privyWalletId: outcome.privyWalletId },
    unlockMode: outcome.unlockMode,
    agentKey: outcome.isAgentKeyNew ? "made" : "kept",
    pairing: { link: outcome.pairingLink.reveal(), expiresAtMs: outcome.pairingExpiresAtMs },
    configFile: outcome.configFile,
    model: model === undefined ? null : { provider: model.preset, model: model.model },
    disclaimer: outcome.disclaimer,
    telemetry: outcome.telemetry,
  };
  report.output.json(answer);
  return 0;
}
