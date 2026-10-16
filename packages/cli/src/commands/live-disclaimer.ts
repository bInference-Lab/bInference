import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { CommandRun } from "../program/command-run.js";
import { askDisclaimer } from "../term/disclaimer-question.js";

/**
 * Shows the disclaimer and the privacy statement before an agent goes live, when the engine holds
 * no acceptance of the current text (decisions 0060 and 0220), and asks the person at the
 * terminal to type the phrase back: "I understand", or its words in the owner's language. A wrong
 * answer asks again; a person who cancels stays where they were. Nobody at the terminal, `--yes`
 * or `--json` is refused with `agent.disclaimer`, so no script accepts it unread. Answers whether
 * the owner accepted.
 */
export async function acceptDisclaimer(run: CommandRun, options: CommonOptions): Promise<boolean> {
  const { prompter } = run.host;
  if (prompter === undefined || options.yes || options.json) {
    const phrase = run.formatter.message("disclaimer.phrase");
    run.output.fail({ code: "agent.disclaimer", key: "live.needsTerminal", values: { phrase } });
    return false;
  }
  await askDisclaimer(
    prompter,
    (key, values) => run.formatter.message(key, values),
    "cli.live.wrongPhrase",
  );
  return true;
}
