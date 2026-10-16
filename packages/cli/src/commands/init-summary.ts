import { BinferenceError, type JsonValue } from "@binference/core";
import type { Formatter } from "@binference/i18n";
import type { InitContext } from "../init/init-context.js";
import type { InitOutcome } from "../init/run-init.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { isHomeMoved, runServiceStart } from "./service-start-command.js";
import { setupDoneLines } from "./setup-done-lines.js";

/** What the init command reports with: the command's output and the owner's formatter. */
export interface Report {
  readonly output: CliOutput;
  readonly formatter: Formatter;
  readonly isJson: boolean;
}

function modelLine(context: InitContext, outcome: InitOutcome): string {
  const { model } = outcome;
  const provider = context.words(`model.provider.${model.preset}`);
  return context.words("done.model", { model: model.model, provider, place: model.keyPlace });
}

/**
 * The note that ends a new set-up: the wallet, the model, paper mode and how to go live, where
 * the agent key is kept, the bot's pairing link and the config file; with `--json` the same as
 * one answer. The key of the model is never in it.
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
  const { model } = outcome;
  const answer: JsonValue = {
    state: "set_up",
    wallet: { address: outcome.walletAddress, privyWalletId: outcome.privyWalletId },
    unlockMode: outcome.unlockMode,
    agentKey: outcome.isAgentKeyNew ? "made" : "kept",
    pairing: { link: outcome.pairingLink.reveal(), expiresAtMs: outcome.pairingExpiresAtMs },
    configFile: outcome.configFile,
    model: { provider: model.preset, model: model.model },
    disclaimer: outcome.disclaimer,
    telemetry: outcome.telemetry,
  };
  report.output.json(answer);
  return 0;
}

// The install is set up: a person who cancels here starts binference later.
async function wantsService(context: InitContext): Promise<boolean> {
  const { words } = context;
  try {
    const picked = await context.prompter.choose({
      id: "service",
      message: words("service.ask"),
      options: [
        { value: "yes", label: words("service.yes") },
        { value: "no", label: words("service.no") },
      ],
    });
    return picked === "yes";
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "cli.prompt_cancelled") {
      return false;
    }
    throw error;
  }
}

/**
 * The service step, last of a new set-up, once init let go of the state folder (ARCHITECTURE
 * section 27; decision 0222): a person at the terminal may start binference as the background
 * service now, as `binference start` does, and its exit code is the command's. Otherwise, and
 * when `BINFERENCE_HOME` moves the state folder, init names the command that starts it.
 */
export async function finishSetUp(context: InitContext, report: Report): Promise<ExitCode> {
  const { prompter, words, host } = context;
  if (!context.isInteractive) {
    prompter.outro(words("done.next"));
    return 0;
  }
  if (isHomeMoved(host)) {
    prompter.outro(words("service.homeMoved"));
    return 0;
  }
  const picked = await wantsService(context);
  if (!picked) {
    prompter.outro(words("done.next"));
    return 0;
  }
  const started = await runServiceStart(host, report.output, []);
  prompter.outro(words(started === 0 ? "done.nextService" : "done.next"));
  return started;
}
