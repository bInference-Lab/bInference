import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { CommandRun } from "../program/command-run.js";

/** What a command that removes local state asks before it starts: its messages and its plan. */
export interface TypedConfirmation {
  /** The `cli` messages' area: `<area>.phrase`, `<area>.title`, `<area>.ask` and `<area>.needsYes`. */
  readonly area: "uninstall" | "reset";
  /** The `cli` message that says what the command does, shown above the question. */
  readonly planKey: string;
  /** The values the plan names, such as the state folder. */
  readonly values?: Readonly<Record<string, string>>;
}

/**
 * Asks the person at the terminal to type the command's phrase in their language, after its plan;
 * a wrong answer asks again. With `--yes` nobody is asked. With nobody at the terminal, or with
 * `--json`, and no `--yes`, it refuses with `cli.needs_confirmation` and answers false.
 */
export async function isTypedConfirmed(
  run: CommandRun,
  options: CommonOptions,
  asked: TypedConfirmation,
): Promise<boolean> {
  const { area } = asked;
  const words = (key: string, values: Readonly<Record<string, string>> = {}): string =>
    run.formatter.message(`cli.${area}.${key}`, values);
  const phrase = words("phrase");
  if (options.yes) {
    return true;
  }
  const { prompter } = run.host;
  if (prompter === undefined || options.json) {
    run.output.fail({
      code: "cli.needs_confirmation",
      key: `${area}.needsYes`,
      values: { phrase },
    });
    return false;
  }
  prompter.note(run.formatter.message(`cli.${asked.planKey}`, asked.values ?? {}), words("title"));
  const ask = words("ask", { phrase });
  await prompter.ask({
    id: `${area}Confirm`,
    message: ask,
    check: (answer) => (answer.trim() === phrase ? undefined : ask),
  });
  return true;
}
