import { type ProtocolId, protocolIdSchema } from "@binference/protocol";
import { Argument, Command, InvalidArgumentError, Option, type OptionValues } from "commander";
import {
  type AgentFlags,
  agentFlagsSchema,
  type CheckFlags,
  checkFlagsSchema,
  type CommonOptions,
  commonFlagsSchema,
  type InitFlags,
  initFlagsSchema,
  type LogsFlags,
  logsFlagsSchema,
  maxLogLines,
  type StartFlags,
  startFlagsSchema,
  type WalletAddressFlags,
  walletAddressFlagsSchema,
} from "./cli-flags.schema.js";
import type { CliHost } from "./cli-host.js";

/** The approval mode `binference approval` sets. */
export type ApprovalModeChoice = "manual" | "auto";

/** The command that runs, with its options checked. */
export type ChosenCommand =
  | { readonly name: "init"; readonly options: InitFlags }
  | { readonly name: "start"; readonly options: StartFlags }
  | { readonly name: "status" | "health"; readonly options: CommonOptions }
  | { readonly name: "logs"; readonly options: LogsFlags }
  | {
      readonly name: "approval";
      readonly options: AgentFlags;
      /** The mode to set; the command shows the mode when left out. */
      readonly mode?: ApprovalModeChoice;
    }
  | {
      readonly name: "confirm" | "deny";
      readonly options: CommonOptions;
      readonly intent: ProtocolId<"intent">;
    }
  | { readonly name: "live" | "paper" | "walletList"; readonly options: AgentFlags }
  | { readonly name: "walletAddress"; readonly options: WalletAddressFlags }
  | { readonly name: "check"; readonly options: CheckFlags };

/** What the program is built from. */
export interface ProgramOptions {
  readonly version: string;
  /** A message of the `cli` area in the owner's language. */
  readonly message: (key: string) => string;
  readonly host: Pick<CliHost, "out" | "err">;
  /** Receives the command commander chose, before it runs. */
  readonly choose: (command: ChosenCommand) => void;
}

function linesOf(value: string): number {
  const lines = Number(value);
  if (!Number.isInteger(lines) || lines < 1 || lines > maxLogLines) {
    throw new InvalidArgumentError(
      `--lines takes a whole number from 1 to ${String(maxLogLines)}.`,
    );
  }
  return lines;
}

function addSet(value: string, earlier: readonly string[]): readonly string[] {
  return [...earlier, value];
}

// An id of the protocol's kind, or a command line commander refuses with one message.
function idOf<K extends "agent" | "intent" | "wallet">(kind: K) {
  return (value: string): ProtocolId<K> => {
    const parsed = protocolIdSchema(kind).safeParse(value);
    if (!parsed.success) {
      throw new InvalidArgumentError(`${value} is not a ${kind} id.`);
    }
    return parsed.data;
  };
}

function withCommon(command: Command, message: (key: string) => string): Command {
  return command
    .option("--json", message("option.json"))
    .option("--yes", message("option.yes"))
    .helpOption("-h, --help", message("option.help"));
}

function agentOption(message: (key: string) => string): Option {
  return new Option("--agent <id>", message("option.agent")).argParser(idOf("agent"));
}

// Commands that act on one agent: its approval mode, and the switch between paper and live.
function addAgentCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  withCommon(program.command("approval").description(message("command.approval")), message)
    .addArgument(new Argument("[mode]", message("argument.mode")).choices(["manual", "auto"]))
    .addOption(agentOption(message))
    .action((mode: ApprovalModeChoice | undefined, flags: OptionValues) =>
      choose({
        name: "approval",
        options: agentFlagsSchema.parse(flags),
        ...(mode === undefined ? {} : { mode }),
      }),
    );
  for (const name of ["live", "paper"] as const) {
    withCommon(program.command(name).description(message(`command.${name}`)), message)
      .addOption(agentOption(message))
      .action((flags: OptionValues) => choose({ name, options: agentFlagsSchema.parse(flags) }));
  }
}

// Commands that answer a card: they name the intent it shows.
function addCardCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  for (const name of ["confirm", "deny"] as const) {
    withCommon(program.command(name).description(message(`command.${name}`)), message)
      .addArgument(new Argument("<intent>", message("argument.intent")).argParser(idOf("intent")))
      .action((intent: ProtocolId<"intent">, flags: OptionValues) =>
        choose({ name, options: commonFlagsSchema.parse(flags), intent }),
      );
  }
}

function addWalletCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const wallet = program
    .command("wallet")
    .description(message("command.wallet"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(wallet.command("list").description(message("command.walletList")), message)
    .addOption(agentOption(message))
    .action((flags: OptionValues) =>
      choose({ name: "walletList", options: agentFlagsSchema.parse(flags) }),
    );
  withCommon(wallet.command("address").description(message("command.walletAddress")), message)
    .addOption(agentOption(message))
    .addOption(new Option("--wallet <id>", message("option.wallet")).argParser(idOf("wallet")))
    .action((flags: OptionValues) =>
      choose({ name: "walletAddress", options: walletAddressFlagsSchema.parse(flags) }),
    );
}

function addInit(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  withCommon(program.command("init").description(message("command.init")), message)
    .option("--privy-app-id <id>", message("option.privyAppId"))
    .option("--privy-app-secret <source>", message("option.privyAppSecret"))
    .option("--bot-token <source>", message("option.botToken"))
    .option("--rescue <address>", message("option.rescue"))
    .addOption(
      new Option("--unlock <mode>", message("option.unlock")).choices([
        "keychain",
        "file",
        "manual",
        "command",
      ]),
    )
    .option("--unlock-command <source>", message("option.unlockCommand"))
    .option("--set <key=value>", message("option.setInit"), addSet, [])
    .option("--start-over", message("option.startOver"))
    .action((flags: OptionValues) =>
      choose({ name: "init", options: initFlagsSchema.parse(flags) }),
    );
}

function addCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  addInit(program, options);
  withCommon(program.command("start").description(message("command.start")), message)
    .option("--set <key=value>", message("option.set"), addSet, [])
    .action((flags: OptionValues) =>
      choose({ name: "start", options: startFlagsSchema.parse(flags) }),
    );
  for (const name of ["status", "health"] as const) {
    withCommon(program.command(name).description(message(`command.${name}`)), message).action(
      (flags: OptionValues) => choose({ name, options: commonFlagsSchema.parse(flags) }),
    );
  }
  withCommon(program.command("logs").description(message("command.logs")), message)
    .option("-n, --lines <count>", message("option.lines"), linesOf)
    .option("-f, --follow", message("option.follow"))
    .action((flags: OptionValues) =>
      choose({ name: "logs", options: logsFlagsSchema.parse(flags) }),
    );
  addAgentCommands(program, options);
  addCardCommands(program, options);
  addWalletCommands(program, options);
  withCommon(program.command("check").description(message("command.check")), message)
    .option("--fix", message("option.fix"))
    .action((flags: OptionValues) =>
      choose({ name: "check", options: checkFlagsSchema.parse(flags) }),
    );
}

/**
 * Builds the `binference` command tree on commander: each command with `--json` and `--yes`, and
 * help in the owner's language. Commander never ends the process: a parse error, help or the
 * version throws a `CommanderError` for the caller to map, and its own English error lines are
 * never written.
 * Builds the `binference` command tree on commander: `init`, `start`, `status`, `health` and `logs`, each
 * with `--json` and `--yes`, and help in the owner's language. Commander never ends the process:
 * a parse error, help or the version throws a `CommanderError` for the caller to map, and its own
 * English error lines are never written.
 */
export function buildProgram(options: ProgramOptions): Command {
  const { message } = options;
  const headings: Readonly<Record<string, string>> = {
    "Usage:": message("help.usage"),
    "Options:": message("help.options"),
    "Commands:": message("help.commands"),
    "Arguments:": message("help.arguments"),
    "Global Options:": message("help.globalOptions"),
  };
  const program = new Command("binference")
    .description(message("program"))
    .version(options.version, "-V, --version", message("option.version"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"))
    .configureHelp({ styleTitle: (title) => headings[title] ?? title })
    .configureOutput({
      writeOut: options.host.out,
      writeErr: options.host.err,
      outputError: () => undefined,
    })
    .showSuggestionAfterError(false)
    .exitOverride();
  addCommands(program, options);
  return program;
}
