import type { Argument, Command, Help } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { buildProgram } from "./cli-program.js";

/** One argument or option of a command, as its help shows it. */
export interface ReferenceTerm {
  /** How the help writes it: `<intent>`, `[mode]`, `--agent <id>`. */
  readonly term: string;
  readonly description: string;
  readonly isRequired: boolean;
  /** The values it takes, when it takes only some. */
  readonly choices?: readonly string[];
}

/** One command of `binference`, with what its help lists. */
export interface ReferenceCommand {
  /** The words that run it after `binference`, such as `wallet create`. */
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly ReferenceTerm[];
  /** Its options, without the ones every command takes: `--json`, `--yes` and `--help`. */
  readonly options: readonly ReferenceTerm[];
}

// The options every command takes, which the reference names once.
const commonOptions: ReadonlySet<string> = new Set(["--json", "--yes", "--help"]);

function withChoices(
  term: Omit<ReferenceTerm, "choices">,
  choices: readonly string[] | undefined,
): ReferenceTerm {
  return choices === undefined ? term : { ...term, choices };
}

// As the usage line writes an argument: `<intent>` when it is required, `[mode]` when not.
function argumentTerm(argument: Argument): string {
  const name = `${argument.name()}${argument.variadic ? "..." : ""}`;
  return argument.required ? `<${name}>` : `[${name}]`;
}

function termsOf(command: Command, help: Help): Pick<ReferenceCommand, "arguments" | "options"> {
  return {
    arguments: help.visibleArguments(command).map((argument) =>
      withChoices(
        {
          term: argumentTerm(argument),
          description: argument.description,
          isRequired: argument.required,
        },
        argument.argChoices,
      ),
    ),
    options: help
      .visibleOptions(command)
      .filter((option) => option.long === undefined || !commonOptions.has(option.long))
      .map((option) =>
        withChoices(
          {
            term: help.optionTerm(option),
            description: option.description,
            isRequired: option.mandatory,
          },
          option.argChoices,
        ),
      ),
  };
}

function entriesOf(command: Command, parents: readonly string[], help: Help): ReferenceCommand[] {
  const words = [...parents, command.name()];
  const own: ReferenceCommand = {
    name: words.join(" "),
    description: command.description(),
    ...termsOf(command, help),
  };
  const children = help
    .visibleCommands(command)
    .filter((child) => child.name() !== "help")
    .flatMap((child) => entriesOf(child, words, help));
  return [own, ...children];
}

/**
 * Every command of `binference` in the order its help lists them, each subcommand after its
 * parent, with its arguments and options in the language of `message`. The docs site's command
 * reference is generated from it, so it says what the program's own help says.
 */
export function commandReference(message: ProgramOptions["message"]): readonly ReferenceCommand[] {
  const program = buildProgram({
    version: "0.0.0",
    message,
    host: { out: () => undefined, err: () => undefined },
    choose: () => undefined,
  });
  const help = program.createHelp();
  return help
    .visibleCommands(program)
    .filter((child) => child.name() !== "help")
    .flatMap((child) => entriesOf(child, [], help));
}
