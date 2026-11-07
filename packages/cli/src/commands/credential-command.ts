import { jsonValueSchema } from "@binference/core";
import { operations } from "@binference/protocol";
import { z } from "zod";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withEngine } from "./connect-engine.js";

/**
 * `binference credential list`: every credential the owner stored for the agents, by name, with
 * the hosts it may be sent to and when it was stored, through `credential/list`. No value is ever
 * shown. With `--json` it prints the list as the operation answers it.
 */
export async function runCredentialList(run: CommandRun): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const page = await client.call("credential/list", {}, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["credential/list"].result, page)));
    output.say("credential.count", { count: page.items.length });
    for (const item of page.items) {
      const hosts = item.allowedHosts.length === 0 ? "-" : item.allowedHosts.join(", ");
      output.item("credential.item", {
        name: item.name,
        hosts,
        when: run.formatter.dateTime(item.updatedAt),
      });
    }
    return 0;
  });
}

/**
 * `binference credential set <name>`: stores a credential through `credential/set` (decision
 * 0388), its value typed at a hidden prompt, never a flag, and the hosts it may be sent to from
 * each `--allow-host`. With `--yes`, `--json` or nobody at the terminal it refuses, as no value can
 * be asked for.
 */
export async function runCredentialSet(
  run: CommandRun,
  request: {
    readonly options: CommonOptions & { readonly allowHost?: readonly string[] };
    readonly name: string;
  },
): Promise<ExitCode> {
  const { host, output } = run;
  const { options, name } = request;
  if (host.prompter === undefined || options.yes || options.json) {
    output.fail({ code: "protocol.bad_args", key: "credential.needsTerminal" });
    return 1;
  }
  const value = await host.prompter.ask({
    id: "credential",
    message: run.formatter.message("cli.credential.ask", { name }),
    isSecret: true,
  });
  const allowedHosts = (options.allowHost ?? []).map((each) => each.toLowerCase());
  return withEngine(host, output, async (client, signal) => {
    const stored = await client.call("credential/set", { name, value, allowedHosts }, { signal });
    output.say("credential.stored", {
      name: stored.name,
      hosts: stored.allowedHosts.length === 0 ? "-" : stored.allowedHosts.join(", "),
    });
    return 0;
  });
}

/**
 * `binference credential delete <name>`: removes a credential through `credential/delete`; it is
 * gone from every read at once and purged with its value 30 days later. With `--json` it prints
 * `{ name }`.
 */
export async function runCredentialDelete(
  run: CommandRun,
  request: { readonly name: string },
): Promise<ExitCode> {
  const { host, output } = run;
  const { name } = request;
  return withEngine(host, output, async (client, signal) => {
    await client.call("credential/delete", { name }, { signal });
    output.json({ name });
    output.say("credential.deleted", { name });
    return 0;
  });
}
