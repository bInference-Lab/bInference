import { jsonValueSchema } from "@binference/core";
import { type LimitLine, limitLines } from "@binference/i18n";
import { type LimitChanges, type LimitsView, operations } from "@binference/protocol";
import { z } from "zod";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import type { AgentFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withAgent } from "./agent-choice.js";
import { gasReserveKey, limitChangesOf, limitConfigKeys } from "./limit-keys.js";

/** How limits print: the line's message, its time, and the limits it leaves out. */
interface LimitLines {
  readonly key: string;
  readonly when?: string;
  /** Limits printed elsewhere, such as the ones that wait. */
  readonly except?: LimitChanges;
}

// The key `limit set` takes for the limit a line names.
function keyOf(line: LimitLine): string {
  return line.field === "gasReserve"
    ? `${gasReserveKey}.${line.chain}`
    : limitConfigKeys[line.field];
}

function isPrintedElsewhere(line: LimitLine, except: LimitChanges): boolean {
  return line.field === "gasReserve"
    ? Object.keys(except.gasReserve ?? {}).includes(line.chain)
    : except[line.field] !== undefined;
}

// Each limit `changes` names, as a line under the message `lines.key`.
function printLimits(run: CommandRun, changes: LimitChanges, lines: LimitLines): void {
  const except = lines.except ?? {};
  const display = { formatter: run.formatter, chains: selfHostedChains() };
  for (const line of limitLines(changes, display)) {
    if (!isPrintedElsewhere(line, except)) {
      const { name, value } = line;
      run.output.item(lines.key, { name, key: keyOf(line), value, when: lines.when ?? "" });
    }
  }
}

function printView(run: CommandRun, view: LimitsView): void {
  run.output.json(jsonValueSchema.parse(z.encode(operations["limit/get"].result, view)));
}

/**
 * `binference limit [--agent <id>]`: the agent's limits through `limit/get`: each limit in effect
 * by the key `limit set` takes, and the looser ones that wait with when they apply. With `--json`
 * it prints the limits as the operation answers them.
 */
export async function runLimit(
  run: CommandRun,
  request: { readonly options: AgentFlags },
): Promise<ExitCode> {
  const { output, formatter } = run;
  return withAgent(run, request.options.agent, async (client, agent, signal) => {
    const view = await client.call("limit/get", { agent }, { signal });
    printView(run, view);
    output.say("limit.heading", { agent });
    printLimits(run, view, { key: "limit.item" });
    if (view.pending !== undefined) {
      output.say("limit.pendingHeading", { when: formatter.dateTime(view.pending.effectiveAt) });
      printLimits(run, view.pending.changes, { key: "limit.item" });
    }
    return 0;
  });
}

/** What `binference limit set` was asked: each limit as `key=value`, and the agent. */
export interface LimitSetRequest {
  readonly options: AgentFlags;
  readonly sets: readonly string[];
}

// The limits asked for that apply now, then those that wait with their time.
function reportSet(run: CommandRun, view: LimitsView, asked: LimitChanges): void {
  printView(run, view);
  const { pending } = view;
  printLimits(run, asked, { key: "limit.now", except: pending?.changes ?? {} });
  if (pending !== undefined) {
    const when = run.formatter.dateTime(pending.effectiveAt);
    printLimits(run, pending.changes, { key: "limit.waits", when });
  }
}

/**
 * `binference limit set <key=value>... [--agent <id>]`: changes the agent's limits through
 * `limit/set` (decision 0111), each written as `key=value` with the key and units `defaults` uses
 * in config.json5. A stricter value applies at once; a looser one waits 24 hours, is announced on
 * every surface, and `binference limit cancel` drops it. A key no limit has or a value it does not
 * take is refused before anything is sent. With `--json` it prints the limits after the change.
 */
export async function runLimitSet(run: CommandRun, request: LimitSetRequest): Promise<ExitCode> {
  const changes = limitChangesOf(selfHostedChains(), request.sets);
  if (!changes.ok) {
    const error = changes.problem;
    if (error.kind === "bad_set") {
      run.output.fail({
        code: "protocol.bad_args",
        key: "limit.badSet",
        values: { set: error.set },
      });
    } else {
      run.output.fail({ code: "protocol.bad_args", key: "limit.badValue", values: { ...error } });
    }
    return 1;
  }
  return withAgent(run, request.options.agent, async (client, agent, signal) => {
    const args = { agent, changes: changes.value };
    reportSet(run, await client.call("limit/set", args, { signal }), changes.value);
    return 0;
  });
}

/**
 * `binference limit cancel [--agent <id>]`: drops the looser limits that wait, through
 * `limit/cancelPending`; the limits in effect stay, and every surface hears of it. With `--json`
 * it prints the limits after the cancel.
 */
export async function runLimitCancel(
  run: CommandRun,
  request: { readonly options: AgentFlags },
): Promise<ExitCode> {
  const { output } = run;
  return withAgent(run, request.options.agent, async (client, agent, signal) => {
    const before = await client.call("limit/get", { agent }, { signal });
    const view = await client.call("limit/cancelPending", { agent }, { signal });
    printView(run, view);
    output.say(before.pending === undefined ? "limit.nothingWaits" : "limit.cancelled");
    return 0;
  });
}
