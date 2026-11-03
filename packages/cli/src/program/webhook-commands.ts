import type { ProtocolId } from "@binference/protocol";
import { Argument, type Command, InvalidArgumentError, Option, type OptionValues } from "commander";
import type { ProgramOptions } from "./chosen-command.js";
import { commonFlagsSchema } from "./cli-flags.schema.js";
import { agentOption, idOf, ttlOption, withCommon } from "./command-options.js";
import { webhookCreateFlagsSchema, webhookEventsFlagsSchema } from "./webhook-flags.schema.js";

// A rule lasts at most a year from the CLI; its default, 30 days, comes from the engine.
const ruleLifetimeMaxMs = 365 * 86_400_000;

// A whole number from 1 to `most`, or a command line commander refuses with one message.
function wholeOf(flag: string, most: number): (value: string) => number {
  return (value: string): number => {
    const count = /^[1-9]\d{0,14}$/.test(value) ? Number(value) : 0;
    if (count < 1 || count > most) {
      throw new InvalidArgumentError(`${flag} takes a whole number from 1 to ${String(most)}.`);
    }
    return count;
  };
}

function ruleArgument(message: ProgramOptions["message"]): Argument {
  return new Argument("<rule>", message("argument.rule")).argParser(idOf("webhookRule"));
}

function addCreate(webhook: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  withCommon(webhook.command("create").description(message("command.webhookCreate")), message)
    .requiredOption("--name <text>", message("option.ruleName"))
    .requiredOption("--token <token>", message("option.ruleToken"))
    .addOption(
      new Option("--side <side>", message("option.ruleSide"))
        .choices(["buy", "sell"])
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--usd <dollars>", message("option.ruleUsd")).conflicts(["amount", "percent"]),
    )
    .addOption(new Option("--amount <amount>", message("option.ruleAmount")).conflicts("percent"))
    .option("--percent <percent>", message("option.rulePercent"))
    .option("--spend <token>", message("option.ruleSpend"))
    .option("--worst-price <dollars>", message("option.ruleWorstPrice"))
    .option("--slippage <percent>", message("option.ruleSlippage"))
    .addOption(
      new Option("--max-fills <count>", message("option.ruleMaxFills")).argParser(
        wholeOf("--max-fills", 1_000_000),
      ),
    )
    .addOption(
      new Option("--rate <count>", message("option.ruleRate")).argParser(wholeOf("--rate", 60)),
    )
    .addOption(ttlOption(message("option.ruleTtl"), ruleLifetimeMaxMs))
    .addOption(agentOption(message))
    .addOption(new Option("--wallet <id>", message("option.wallet")).argParser(idOf("wallet")))
    .action((flags: OptionValues) =>
      choose({ name: "webhookCreate", options: webhookCreateFlagsSchema.parse(flags) }),
    );
}

/**
 * Adds the alert rule commands: `webhook list`, `webhook create`, which shows the rule's URL once
 * and its card, `webhook events`, `webhook rotate` and `webhook delete`.
 */
export function addWebhookCommands(program: Command, options: ProgramOptions): void {
  const { message, choose } = options;
  const webhook = program
    .command("webhook")
    .description(message("command.webhook"))
    .helpOption("-h, --help", message("option.help"))
    .helpCommand("help [command]", message("option.help"));
  withCommon(webhook.command("list").description(message("command.webhookList")), message).action(
    (flags: OptionValues) =>
      choose({ name: "webhookList", options: commonFlagsSchema.parse(flags) }),
  );
  addCreate(webhook, options);
  withCommon(webhook.command("events").description(message("command.webhookEvents")), message)
    .addArgument(ruleArgument(message))
    .addOption(
      new Option("--before <event>", message("option.ruleBefore")).argParser(
        wholeOf("--before", Number.MAX_SAFE_INTEGER),
      ),
    )
    .action((rule: ProtocolId<"webhookRule">, flags: OptionValues) =>
      choose({ name: "webhookEvents", options: webhookEventsFlagsSchema.parse(flags), rule }),
    );
  for (const verb of ["rotate", "delete"] as const) {
    const key = verb === "rotate" ? "command.webhookRotate" : "command.webhookDelete";
    withCommon(webhook.command(verb).description(message(key)), message)
      .addArgument(ruleArgument(message))
      .action((rule: ProtocolId<"webhookRule">, flags: OptionValues) =>
        choose({
          name: verb === "rotate" ? "webhookRotate" : "webhookDelete",
          options: commonFlagsSchema.parse(flags),
          rule,
        }),
      );
  }
}
