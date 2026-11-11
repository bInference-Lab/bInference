import { jsonValueSchema } from "@binference/core";
import { operations, type ProtocolId, type ShellAnswer } from "@binference/protocol";
import { z } from "zod";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withEngine } from "./connect-engine.js";

/**
 * `binference shell requests`: every command of the agents that waits for the owner's answer
 * (decision 0409), with its folder and until when it waits, through `shell/requests`. With `--json`
 * it prints the list as the operation answers it.
 */
export async function runShellRequests(run: CommandRun): Promise<ExitCode> {
  const { host, output, formatter } = run;
  return withEngine(host, output, async (client, signal) => {
    const page = await client.call("shell/requests", {}, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["shell/requests"].result, page)));
    output.say("shell.requestCount", { count: page.items.length });
    for (const item of page.items) {
      output.item("shell.requestItem", {
        request: item.request,
        command: item.command,
        folder: item.folder,
        until: formatter.time(item.closesAt),
        always: item.canAlwaysAllow ? "yes" : "no",
      });
    }
    return 0;
  });
}

/**
 * `binference shell allow <request>` and `binference shell refuse <request>`: the owner's answer to
 * a shell request through `shell/answer`; `--always` keeps the command allowed. With `--json` it
 * prints `{ outcome }`.
 */
export async function runShellAnswer(
  run: CommandRun,
  chosen: { readonly request: ProtocolId<"shellRequest">; readonly answer: ShellAnswer },
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const { request, answer } = chosen;
    const { outcome } = await client.call("shell/answer", { request, answer }, { signal });
    output.json({ outcome });
    output.say("shell.answered", { outcome });
    return 0;
  });
}

/**
 * `binference shell allowed list`: every command the owner allowed always, with the folder it runs
 * in and when it was allowed, through `shell/allowed`.
 */
export async function runShellAllowedList(run: CommandRun): Promise<ExitCode> {
  const { host, output, formatter } = run;
  return withEngine(host, output, async (client, signal) => {
    const page = await client.call("shell/allowed", {}, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["shell/allowed"].result, page)));
    output.say("shell.allowedCount", { count: page.items.length });
    for (const item of page.items) {
      output.item("shell.allowedItem", {
        allowed: item.allowed,
        command: item.text,
        folder: item.folder,
        when: formatter.dateTime(item.allowedAt),
      });
    }
    return 0;
  });
}

/**
 * `binference shell allowed remove <allowed>`: removes an allowed command through
 * `shell/disallow`, journaled and announced; the command asks again next time. With `--json` it
 * prints `{ allowed }`.
 */
export async function runShellAllowedRemove(
  run: CommandRun,
  chosen: { readonly allowed: ProtocolId<"allowedCommand"> },
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    await client.call("shell/disallow", { allowed: chosen.allowed }, { signal });
    output.json({ allowed: chosen.allowed });
    output.say("shell.removed", { allowed: chosen.allowed });
    return 0;
  });
}
